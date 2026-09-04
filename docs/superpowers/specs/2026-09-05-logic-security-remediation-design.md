# Technical Design Specification: Logic, Security & Architectural Remediation (Hardened & Refined)

**Document Version:** 2.0.0  
**Target Milestone:** Enterprise Hardening & Production-Ready Compliance  
**Date:** 2026-09-05  
**Author:** AI Engineering Lead (BE & Security Specialist)  
**Status:** **SPECIFICATION COMPLETE (Strictly Read-Only Analysis Baseline)**  
**Related Audit:** `docs/reports/2026-09-05-GAP-AND-SECURITY-REMEDIATION-REVIEW.md`

---

## 1. Scope & System Architectural Baseline

Following the exhaustive repository audit, this design specification formalizes the architectural contracts, data models, state-machine transitions, concurrency controls, and failure recovery protocols across all seven remediated areas:

1. **WebRTC Signaling Nonce & Replay Protection (`P0` / `FR-RTSEC-03/04`):** Cryptographic replay defense, sequence validation, and timeout handling.
2. **Terminal Delivery State & Route Mutation Invariant (`P0` / `FR-DEL-05`):** Complete lockdown of route recommendation, selection, and manual reordering on terminal deliveries.
3. **Multi-Tenancy & Tenant Resource Scoping (`P1` / `SEC-002`):** First-class `Organization` data model and tenant isolation across all services, repositories, and WebSocket rooms.
4. **Emergency (SOS) Management Subsystem (`P1` / `FR-EMG-01..04`):** Production-ready SOS panic alert trigger, real-time dispatcher broadcast, and audit-logged lifecycle.
5. **Driver Operational Status Synchronization (`P1` / `FR-DRV-02`):** Bi-directional state synchronization between delivery execution and driver availability.
6. **Transactional Realtime Event Outbox (`P2` / `NFR-REL-02/03`):** At-least-once guaranteed event delivery resilient to Redis failures.
7. **Automated Data Retention & Privacy Purge (`P2` / `DATA-PRIV-001`):** Scheduled cleanup routine for expired telemetry partitions, idempotency records, and revoked sessions.

---

## 2. Multi-Tenancy Architecture (Organization Isolation)

### 2.1 Relational Schema Extension (`prisma/schema.prisma`)

```prisma
model Organization {
  id          String       @id @default(uuid()) @db.Uuid
  code        String       @unique @db.VarChar(50)
  name        String       @db.VarChar(150)
  status      String       @default("ACTIVE") @db.VarChar(20) // ACTIVE, SUSPENDED
  createdAt   DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime     @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  users       User[]
  drivers     Driver[]
  vehicles    Vehicle[]
  deliveries  Delivery[]

  @@map("organizations")
}
```

**Foreign Key Bindings:**
- `User`: `organizationId String? @map("organization_id") @db.Uuid` (`SUPER_ADMIN` is system-wide nullable; `OWNER`, `ADMIN`, `DRIVER` are strictly bound).
- `Driver`: `organizationId String @map("organization_id") @db.Uuid`
- `Vehicle`: `organizationId String @map("organization_id") @db.Uuid`
- `Delivery`: `organizationId String @map("organization_id") @db.Uuid`

### 2.2 Tenant Identity Context & Guard Enforcement

1. **JWT Strategy Propagation:**
   `JwtStrategy.validate()` extracts `organizationId` from the verified user record and attaches it to `req.user.organizationId`.
2. **Context Derivation (Zero Client Spoofing):**
   No controller or DTO accepts `organizationId` from the client request body. The active tenant is derived strictly from `req.user.organizationId`.
3. **Query Scoping Rules:**
   - `FleetService.getAllActiveDriverLocations`:
     ```typescript
     const where: Prisma.DriverWhereInput = {
       user: { status: 'ACTIVE' },
       operationalStatus: { in: ['AVAILABLE', 'ON_DELIVERY', 'EMERGENCY'] },
     };
     if (actorRole !== 'SUPER_ADMIN') {
       where.organizationId = actorOrgId;
     }
     ```
   - `DeliveriesService`, `TrackingService`, `RoutesDomainService`: Every query includes `where: { organizationId: actorOrgId }`.
   - `WsRoomAuthorizerService`: Validates that client socket `organizationId` matches target resource `organizationId` before joining `fleet:monitoring` or `delivery:<id>`.

---

## 3. WebRTC Signaling Nonce & Replay Defense (P0 Remediation)

### 3.1 Signaling Protocol Envelope (`WebrtcSignalingBaseDto`)

All WebRTC signaling WebSocket events (`webrtc.signal.offer`, `webrtc.signal.answer`, `webrtc.signal.ice_candidate`) must extend `WebrtcSignalingBaseDto`:

```typescript
export class WebrtcSignalingBaseDto {
  @IsUUID('4')
  @IsNotEmpty()
  sessionId: string;

  @IsUUID('4')
  @IsNotEmpty()
  nonce: string; // Random client-generated UUIDv4 per packet

  @IsInt()
  @Min(1)
  seq: number; // Strictly monotonic integer sequence per sender-peer

  @IsInt()
  timestamp: number; // Client timestamp in epoch ms
}
```

### 3.2 Atomic Verification & Replay Protection Algorithm

In `RealtimeGateway.handleWebrtcSignal*`:
```text
Step 1: Check clock skew.
        If |currentTime - dto.timestamp| > 30000 ms:
            Emit 'call_error' ({ code: 'CLOCK_SKEW_EXCEEDED', message: 'Timestamp skew > 30s' })
            Drop packet.

Step 2: Atomic Nonce Claim via Redis:
        const nonceKey = `replay:nonce:${dto.sessionId}:${dto.nonce}`;
        const claimed = await redis.set(nonceKey, '1', 'EX', 60, 'NX');
        if (!claimed) {
            Emit 'call_error' ({ code: 'REPLAY_DETECTED', message: 'Signaling nonce already used' })
            Drop packet.
        }

Step 3: Monotonic Sequence Number Check:
        const seqKey = `seq:webrtc:${dto.sessionId}:${client.data.userId}`;
        const lastSeqStr = await redis.get(seqKey);
        if (lastSeqStr) {
            const lastSeq = parseInt(lastSeqStr, 10);
            if (dto.seq <= lastSeq) {
                Emit 'call_error' ({ code: 'OUT_OF_ORDER_SEQUENCE', message: 'Out of order sequence' })
                Drop packet.
            }
        }
        await redis.set(seqKey, dto.seq.toString(), 'EX', 3600);

Step 4: Relay signaling payload to room `session:${dto.sessionId}`.
```

### 3.3 Call Session Watchdog & Persistent Timeout Recovery
- **Problem in Current Code:** Memory-only `setTimeout` drops if process restarts.
- **Remediation:** In addition to in-memory timer, write a Redis scheduled trigger `EXPIRE session:timeout:${sessionId} 30`. A periodic polling sweep (every 10s) in `CallSessionService` marks expired `PENDING` sessions as `TIMEOUT` directly in PostgreSQL:
  ```sql
  UPDATE realtime_sessions
  SET status = 'TIMEOUT'
  WHERE status = 'PENDING' AND expires_at <= NOW();
  ```

---

## 4. Delivery & Route State-Machine Hardening (P0 Remediation)

### 4.1 Invariant: Terminal Deliveries Forbid Route Mutations

In `src/modules/routes/services/routes-domain.service.ts`:
Add explicit terminal guard to `recommendRoute`, `selectRoute`, and `reorderStops`:

```typescript
private readonly TERMINAL_DELIVERY_STATUSES: DeliveryStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED'];

private ensureDeliveryOperational(status: DeliveryStatus): void {
  if (this.TERMINAL_DELIVERY_STATUSES.includes(status)) {
    throw new ConflictException({
      code: 'INVALID_DELIVERY_STATE',
      message: `Cannot mutate route while delivery is in terminal state ${status}`,
    });
  }
}
```

Executed within the route mutation database transaction under pessimistic lock (`SELECT id FROM deliveries WHERE id = ... FOR UPDATE`).

### 4.2 Driver Operational Status Invariant (`P1 Remediation`)

`Driver.operationalStatus` must be synchronized in real time with the delivery lifecycle:
```text
Delivery State Transition         Driver Operational Status Effect
─────────────────────────────────────────────────────────────────────────────
DRAFT -> ASSIGNED                 No change (Driver remains AVAILABLE)
ASSIGNED -> ACCEPTED              Driver.operationalStatus = 'AVAILABLE'
ACCEPTED -> EN_ROUTE              Driver.operationalStatus = 'ON_DELIVERY'
EN_ROUTE -> COMPLETED             Driver.operationalStatus = 'AVAILABLE' (or OFFLINE if shift done)
* -> CANCELLED                    Driver.operationalStatus = 'AVAILABLE' (if currently ON_DELIVERY)
SOS Panic Triggered               Driver.operationalStatus = 'EMERGENCY'
SOS Panic Resolved                Driver.operationalStatus = Reverted to pre-emergency status
```

Implemented atomically inside `DeliveriesService.$transaction` calls.

---

## 5. Emergency (SOS) Management Subsystem (P1 Remediation)

### 5.1 Architecture & Endpoints

```text
POST /v1/me/emergencies            -> Driver triggers SOS distress alert
GET  /v1/me/emergencies/active     -> Driver gets active emergency record
GET  /v1/emergencies               -> Dispatcher/Owner queries list (filtered by status, date, driver)
GET  /v1/emergencies/:id           -> Details of specific emergency
PATCH /v1/emergencies/:id/status   -> Dispatcher updates status (ACKNOWLEDGED, RESOLVED, FALSE_ALARM)
```

### 5.2 Atomic Trigger Flow (`POST /v1/me/emergencies`)

```typescript
export class TriggerEmergencyDto {
  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsString()
  @IsNotEmpty()
  emergencyType: string; // ACCIDENT, MEDICAL, CRIME_SECURITY, VEHICLE_BREAKDOWN

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID('4')
  deliveryId?: string;
}
```

**Transaction Steps:**
1. Derive `driverId` and `organizationId` from authenticated driver.
2. Insert row into `emergencies` table. PostGIS trigger `trg_sync_emergencies_geom` computes spatial `geom` point automatically.
3. Update `Driver.operationalStatus = 'EMERGENCY'`.
4. Record Audit Log (`EMERGENCY_TRIGGERED`).
5. Enqueue Outbox Event `emergency.triggered`.
6. Publish real-time alert envelope to room `organization:<orgId>:emergencies` and `fleet:monitoring`.

### 5.3 Resolution Flow (`PATCH /v1/emergencies/:id/status`)

- Allowed Transitions:
  - `TRIGGERED` $\rightarrow$ `ACKNOWLEDGED`, `RESOLVED`, `FALSE_ALARM`
  - `ACKNOWLEDGED` $\rightarrow$ `RESOLVED`, `FALSE_ALARM`
  - `RESOLVED` and `FALSE_ALARM` are terminal.
- When transitioning to terminal state:
  - Check if driver has active `EN_ROUTE` delivery: if yes, set `Driver.operationalStatus = 'ON_DELIVERY'`; otherwise `AVAILABLE`.
  - Set `resolvedAt = NOW()` and `resolvedBy = actor.userId`.
  - Emit real-time update to `organization:<orgId>:emergencies`.

---

## 6. Transactional Event Outbox Subsystem (P2 Remediation)

### 6.1 Database Model (`prisma/schema.prisma`)

```prisma
enum OutboxStatus {
  PENDING
  PUBLISHED
  FAILED
}

model OutboxEvent {
  id          String       @id @default(uuid()) @db.Uuid
  topic       String       @db.VarChar(100)
  payload     Json         @map("payload")
  status      OutboxStatus @default(PENDING)
  retryCount  Int          @default(0) @map("retry_count")
  error       String?      @db.Text
  createdAt   DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  publishedAt DateTime?    @map("published_at") @db.Timestamptz(3)

  @@index([status, createdAt])
  @@map("outbox_events")
}
```

### 6.2 Guaranteed Delivery Semantics (At-Least-Once)

1. **Transactional Enqueue:** When mutating Delivery, Stop, or Emergency, create `tx.outboxEvent.create(...)` in the same database transaction.
2. **Outbox Relay Worker (`OutboxRelayService`):**
   - Runs every 1000ms.
   - Queries `SELECT * FROM outbox_events WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED`.
   - Dispatches payload to Redis Pub/Sub topic.
   - On success: `UPDATE outbox_events SET status = 'PUBLISHED', published_at = NOW()`.
   - On error: `retryCount++`. If `retryCount >= 5`, marks `status = 'FAILED'`.
   - Ensures zero dropped events during Redis restarts or network flickers.

---

## 7. Automated Data Retention & Privacy Purge (P2 Remediation)

### 7.1 Retention Policy Specification

| Target Entity | Inactive / Expired Criteria | Purge Action | Execution Cadence |
|---|---|---|---|
| `location_points` | `recorded_at < NOW() - INTERVAL '90 days'` | Batched delete / drop monthly partition | Daily at 02:00 UTC |
| `idempotency_records` | `expires_at < NOW()` | Batched delete (`LIMIT 1000`) | Hourly |
| `sessions` | `is_revoked = TRUE AND updated_at < NOW() - INTERVAL '30 days'` | Batched delete | Daily at 03:00 UTC |
| `outbox_events` | `status = 'PUBLISHED' AND published_at < NOW() - INTERVAL '7 days'` | Batched delete | Daily at 04:00 UTC |

### 7.2 Idempotent Retention Runner (`RetentionService`)

- Executes small chunked transactions (`DELETE FROM ... WHERE id IN (SELECT id FROM ... LIMIT 1000)`) to prevent database table locking.
- Records structured Audit Log entry with exact deletion metrics upon job completion.

---

## 8. Ponytail Principle Architectural Verification

To strictly preserve **Ponytail Level: Full** throughout the design:
- **No external queuing frameworks:** Redis Pub/Sub + PostgreSQL `SKIP LOCKED` replaces Kafka, BullMQ, and RabbitMQ.
- **No ORM bloat:** Direct Prisma models with native PostgreSQL types (`UUID`, `TIMESTAMPTZ`, `GEOMETRY`).
- **No multi-inheritance DTO ladders:** Simple, concise, validated TypeScript classes.
- **Native DB constraints:** All state machine guarantees backed by atomic SQL update conditions (`WHERE status = expected`).
