# Comprehensive Gap, Logic, and Security Review Report (Refined & Hardened Baseline)

**Document Target:** Master Engineering Audit & Invariant Baseline  
**Date:** 2026-09-05  
**Auditor / Engineering Lead:** AI Engineering Agent (BE & Security Specialist)  
**Methodology:** Superpowers Brainstorming & Architectural Review with Ponytail Engineering Principles  
**Status:** **AUDIT & REFINED BASELINE COMPLETE (Strictly Read-Only Analysis; Codebase Unmodified)**  
**Gate Designation:** **NOT READY FOR PRODUCTION / CONDITIONAL MVP (Blocked by P0/P1 Invariants & Security Deficits)**

---

## 1. Executive Summary & Audit Gate Status

An exhaustive, multi-dimensional code inspection was executed across the entire repository (`src/`, `prisma/`, `test/`, and associated ADRs/docs), evaluating all business domain state machines, multi-channel entry points, distributed failure modes, security trust boundaries, race conditions, adversarial threat models, and cross-domain invariants.

### 1.1 Final Audit Gate Designation
- **Current Gate Designation:** **NOT READY / CONDITIONAL**
- **Criteria for Production Readiness:** Zero unresolved P0 findings, zero unresolved P1 findings without explicit documented waiver, and complete automated test verification across all invariants, concurrency matrices, trust boundaries, and partial failure paths.
- **Current Blockers:**
  1. **P0:** WebRTC signaling lacks cryptographic replay defense (`nonce`, sequence, timestamp), permitting call disruption and media hijacking over WebSocket gateway.
  2. **P0:** Delivery cancellation/terminal state invariant bypass on Route and Offline Sync paths (e.g. `POST /v1/deliveries/:id/routes/recommend` and `POST /v1/deliveries/:id/routes/reorder` can mutate routes for CANCELLED or COMPLETED deliveries without checking `status`).
  3. **P1:** Cross-Company Fleet & Resource Exposure (`SEC-002`): Absolute absence of `Organization`/Tenant model in database and services (`FleetService.getAllActiveDriverLocations()` returns all active drivers globally across all companies).
  4. **P1:** Missing Emergency (SOS) Subsystem (`FR-EMG-01..04`): Database tables and PostGIS spatial triggers exist, but zero API controllers, services, DTOs, or WebSocket events exist in application runtime.
  5. **P1:** Driver Operational Status Disconnect: `Driver.operationalStatus` is defined in schema (`OFFLINE`, `AVAILABLE`, `ON_DELIVERY`, `EMERGENCY`) and queried by `FleetService`, but never transitioned or updated by any delivery lifecycle endpoint or socket event.
  6. **P1:** Dual-Write Partial Failure & Inconsistent Realtime State: Mutations commit to PostgreSQL and fire-and-forget emit to Redis/WebSocket without transactional outbox; Redis blip results in silent dropped events and client desynchronization.

---

## 2. Invariant & State-Machine Audit (Domain-by-Domain)

### 2.1 Delivery & Stop State Machine
- **Entities:** `Delivery`, `DeliveryStop`, `Route`, `ProofOfDelivery`, `DeliveryConflict`
- **Delivery Valid States:** `DRAFT` $\rightarrow$ `ASSIGNED` $\rightarrow$ `ACCEPTED` $\rightarrow$ `EN_ROUTE` $\rightarrow$ `COMPLETED` | `FAILED` | `CANCELLED`
- **Stop Valid States:** `PENDING` $\rightarrow$ `EN_ROUTE` $\rightarrow$ `ARRIVED` $\rightarrow$ `UNLOADING` $\rightarrow$ `DELIVERED` | `FAILED` | `SKIPPED`
- **Audited Invariants & Concrete Findings:**
  1. *Terminal Delivery Guard:* Once `Delivery` enters `COMPLETED`, `CANCELLED`, or `FAILED`, no stop, POD, or route mutation should be permitted.
     - *Verified in Code:* `DeliveryStopsService.updateStopIfOperational` and `PodService.submitPod` enforce `delivery: { status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] } }`.
     - *CRITICAL GAP FOUND:* `RoutesDomainService.reorderStops` and `RoutesDomainService.selectRoute` check only `verifyDeliveryAccess`, but DO NOT assert that `delivery.status` is non-terminal! An operator or driver can reorder stops or select a new route on a `CANCELLED` or `COMPLETED` delivery.
  2. *Single Active En-Route Stop:* A driver should only be `EN_ROUTE` or `ARRIVED` or `UNLOADING` at one stop at any given moment. Currently, this constraint is not guarded by a DB partial index or service transaction check across sibling stops.
  3. *Terminal Completion Consensus:* `DeliveriesService.evaluateDeliveryCompletion` evaluates if all stops are terminal. If $\ge 1$ stop is `DELIVERED`, delivery $\rightarrow$ `COMPLETED`; if 0 stops are `DELIVERED` (all `FAILED`/`SKIPPED`), delivery $\rightarrow$ `FAILED`. Handled correctly in REST, but offline sync conflict resolution (`DeliveryConflictsService.resolveConflict`) directly updates `Delivery.status = 'COMPLETED'` without evaluating whether any stops were actually delivered.

### 2.2 Driver Operational Status & Session / Device Lifecycle
- **Entities:** `Driver`, `User`, `Device`, `Session`, `VehicleAssignment`
- **Driver States:** `OFFLINE`, `AVAILABLE`, `ON_DELIVERY`, `EMERGENCY`
- **Audited Invariants & Concrete Findings:**
  1. *Status Transition Void:* In `src/modules/deliveries/services/deliveries.service.ts`, when a delivery is accepted (`acceptDelivery`) or started (`startDelivery`), `Driver.operationalStatus` is NEVER updated from `AVAILABLE` to `ON_DELIVERY`. When completed or cancelled, it is never reverted to `AVAILABLE` or `OFFLINE`.
  2. *Suspended/Revoked Driver Isolation:* When `UsersService.updateUserStatus` suspends or disables a user, it revokes active database sessions and writes `revoked:user:<id>` in Redis with 900s TTL.
     - *WebSocket Enforcement:* `RealtimeGateway.revalidateSensitiveSocket` verifies the token via `WsJwtAuthGuard.validateSocket` on sensitive actions (`chat.message.send`, `webrtc.signal.*`). However, normal telemetry streaming (`driver.location.update`) bypasses `revalidateSensitiveSocket` and only relies on the initial handshake check unless revoked via the Redis pub/sub handler.
     - *GPS REST Bypass:* `TrackingService.processTelemetry` verifies `userRole === 'DRIVER'`, but does NOT check if `user.status === 'SUSPENDED'` or if driver operational status is `OFFLINE`. A suspended driver with an unexpired access token (up to 15m) could continue ingesting GPS telemetry points if Redis is degraded.

### 2.3 WebRTC Call Session & Signaling State Machine
- **Entities:** `RealtimeSession`
- **Valid States:** `PENDING` $\rightarrow$ `ACTIVE` $\rightarrow$ `ENDED` | `DECLINED` | `TIMEOUT`
- **Audited Invariants & Concrete Findings:**
  1. *Watchdog Timeout Race:* `CallSessionService.initiateCallSession` arms an in-memory `setTimeout(..., 30000)` to trigger `handlePendingTimeout`. If the server node crashes or restarts within that 30 seconds, the timeout is lost and the call session remains permanently orphaned in `PENDING` status. Must be backed by a persistent Redis delayed task or database polling query.
  2. *Single Active Call:* The system does not prevent an Owner from initiating multiple concurrent calls to the same Driver, or a Driver from receiving overlapping call invitations from multiple dispatchers.

---

## 3. Multi-Channel Mutation-Path Trace

The codebase accepts mutations through multiple independent ingest channels. We traced every path to identify authorization or validation bypasses:

```text
Mutation Target         REST API Path                 WebSocket Channel              Offline Sync Outbox Path
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
Stop: Depart            POST /v1/me/stops/:id/depart   N/A (REST only)                POST /v1/me/sync/outbox (eventType: stop.depart)
Stop: Arrive            POST /v1/me/stops/:id/arrive   N/A (REST only)                POST /v1/me/sync/outbox (eventType: stop.arrive)
Stop: Unload            POST /v1/me/stops/:id/unload   N/A (REST only)                POST /v1/me/sync/outbox (eventType: stop.unload)
Stop: POD Submit        POST /v1/me/stops/:id/pod      N/A (REST only)                POST /v1/me/sync/outbox (eventType: stop.pod)
Telemetry Ingest        POST /v1/me/location           WS: driver.location.update     POST /v1/me/location/batch
Route Selection         POST /v1/deliveries/:id/routes N/A (REST only)                N/A
Chat Message            POST /v1/conversations/:id/msg WS: chat.message.send          N/A
Emergency Distress      UNIMPLEMENTED                  UNIMPLEMENTED                  UNIMPLEMENTED
```

### Bypass Analysis:
1. **Offline Sync (`POST /v1/me/sync/outbox`) vs REST:**
   - On REST (`POST /v1/me/stops/:id/pod`), the handler enforces `dto.idempotencyKey`, stop status (`UNLOADING` or `ARRIVED`), and locks the stop using `updateMany`.
   - On Offline Sync (`DeliveryConflictsService.syncOutbox`), if a stop is received while the delivery is `CANCELLED`, it catches this and creates a `DeliveryConflict` ticket (`STALE_OFFLINE_COMPLETION`). **However**, if the delivery is `COMPLETED` or `FAILED` on the server, `syncOutbox` falls through and directly calls `this.podService.submitPod`, which throws a `ConflictException` that is swallowed by the `catch (err)` block, leaving no conflict ticket and silently dropping driver evidence!
2. **WebSocket Telemetry (`driver.location.update`) vs REST (`POST /v1/me/location`):**
   - REST enforces rate limiting (1 request / 3s per driver) and returns 429.
   - WebSocket handler in `RealtimeGateway.handleDriverLocationUpdate` forwards to `TrackingService.processTelemetry(..., skipSingleRateLimit: false)`. The logic is shared and unified, properly enforcing geodesic anomaly and clock skew rules.

---

## 4. Distributed Boundary & Failure-Mode Analysis

Auditing atomicity, partial failures, and distributed dependencies across PostgreSQL, Redis, File Storage, and external OSRM:

### 4.1 Database Success $\rightarrow$ Redis / Realtime Failure (Dual-Write Anti-Pattern)
- **Current Behavior:** In `DeliveriesService`, `DeliveryStopsService`, `PodService`, and `RoutesDomainService`, the mutation executes inside `prisma.$transaction(...)`. Immediately after the transaction commits, `broadcastStatusChanged` or `broadcastRouteUpdated` is invoked.
- **Failure Mode:** If Redis or the network fails, the WebSocket event is dropped permanently. Clients observing the live map or dashboard remain out of sync until a manual page refresh.
- **Architectural Violation:** Lack of Transactional Outbox pattern. Events must be written to an `outbox_events` table within the primary database transaction and guaranteed published with **at-least-once** delivery semantics.

### 4.2 File Write Success $\rightarrow$ Database Failure
- **Current Behavior:** In `FileStorageService.saveFileRecord`, the physical file is written first via `localStorageAdapter.saveFile(...)`. Then `prisma.fileRecord.create(...)` is executed.
- **Hardening Verified:** Lines 132-144 feature an explicit compensating `try...catch` block: if `fileRecord.create` fails, `localStorageAdapter.deleteFile(saved.objectKey)` is immediately executed to prevent orphaned disk files.

### 4.3 External OSRM Routing Engine Outage
- **Current Behavior:** In `RoutingService.calculateDistanceMatrix`, if OSRM times out (3000ms) or returns an HTTP 5xx error, the service falls back automatically to `HaversineRoutingProvider.calculateDistanceMatrix`.
- **Finding:** Verified 100% covered by automated tests (`routing-provider.spec.ts`). Fallback is resilient and deterministic.

---

## 5. Security Trust-Boundary Audit

Auditing data origin, client-supplied parameters, and identity context across layers:

### 5.1 Client-Supplied vs. Server-Derived Identity
| Context Variable | Client Input Allowed? | Server Source of Truth | Finding / Vulnerability |
|---|---|---|---|
| `userId` | Strictly rejected | `req.user.id` from verified JWT | Secure. No client override possible. |
| `role` | Strictly rejected | `req.user.role` from verified JWT & DB re-check | Secure. Re-checks DB role on every request. |
| `driverId` | Strictly rejected | Derived via `user.driver.id` in `JwtStrategy` | Secure. Driver cannot spoof another driver's ID. |
| `organizationId` | **MISSING IN SCHEMA** | **MISSING IN SCHEMA** | **CRITICAL (P1):** Multi-tenancy isolation does not exist. |
| `deliveryId` in Telemetry | Optional in client body | Verified against `delivery.driverId === driverId` | Anti-spoofing ownership check verified. |

### 5.2 Multi-Tenancy Boundary Failure (`GAP-SEC-01`)
- In `FleetService.getAllActiveDriverLocations()`:
  ```typescript
  const activeDrivers = await this.prisma.driver.findMany({
    where: {
      user: { status: 'ACTIVE' },
      operationalStatus: { in: ['AVAILABLE', 'ON_DELIVERY', 'EMERGENCY'] },
    },
    // ...
  });
  ```
  Every `OWNER` can view live GPS coordinates, plate numbers, and delivery statuses of vehicles and drivers belonging to all other companies. This is an unacceptable corporate confidentiality breach.

---

## 6. Concurrency / Race-Condition Matrix

| Concurrency Scenario | Potential Race / Hazard | Current Mitigation Mechanism | Status in Code |
|---|---|---|---|
| Concurrent Delivery Stop Claim (A $\leftrightarrow$ B) | Two requests arrive simultaneously to complete/arrive at stop | `prisma.deliveryStop.updateMany({ where: { id, status: expected } })` checking `claimed.count === 1` | **PASS (Race-Safe)** |
| Concurrent POD Upload & Delivery Cancel | Driver submits POD while Owner cancels delivery | Transaction claims stop `status: 'DELIVERED'` conditional on `delivery.status NOT IN terminal` | **PASS (Race-Safe)** |
| Route Reorder $\leftrightarrow$ Concurrent Route Reorder | Version collision or duplicate sequence conflict | `SELECT id FROM deliveries WHERE id = ... FOR UPDATE` + inverted sequence updates | **PASS (Pessimistic Locking)** |
| Route Reorder $\leftrightarrow$ Delivery Cancellation | Reordering stops on a delivery while it is being cancelled | No lock or delivery status check in `reorderStops`! | **FAIL (Missing Check)** |
| Refresh Token Rotation (Race Condition) | Two requests refresh same token concurrently | Atomic Redis lock `refresh:lock:<subFamily>` + DB `tokenFamily` reuse revocation | **PASS (Hardened)** |
| WebRTC Signaling Replay / Duplication | Adversary captures SDP offer and replays via WS | No nonce, no monotonic sequence, no timestamp skew check | **FAIL (P0 Vulnerability)** |
| Prekey Reservation Concurrency | Two sessions attempt to reserve the same E2EE prekey | `UPDATE prekeys ... WHERE is_consumed = FALSE` atomic reservation | **PASS (Atomic SQL)** |

---

## 7. Adversarial & Negative-Path Review (Fail-Closed Analysis)

1. **Malicious Role Escalation:** An attacker registers as `DRIVER` and sends `{ role: 'ADMIN' }`.
   - *Result:* Blocked by NestJS `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` and hardcoded role assignment in `AuthService.register`.
2. **Replay of Expired Tokens:** Client sends expired JWT with valid signature.
   - *Result:* Blocked by `JwtStrategy` with `ignoreExpiration: false`.
3. **Replay of Revoked Token during Redis Outage:**
   - *Result:* In `JwtStrategy.validate`, if Redis is unreachable (`isRevoked === null`), the strategy falls back to querying PostgreSQL session table:
     ```typescript
     if (isSessionRevoked === false || isSessionRevoked === null) {
       const session = await this.prisma.session.findUnique(...);
       // Re-validates DB revocation
     }
     ```
     This implements a **fail-secure** pattern.
4. **Adversarial WebRTC SDP Tampering:** Attacker sends malformed SDP or replayed SDP offer from another conversation.
   - *Result:* Currently relayed directly without schema nonce or cryptographic binding, leading to signaling corruption.

---

## 8. Cross-Domain Invariant Synchronization Matrix

```text
Domain A            Domain B            Expected Invariant Synchronization                               Current Code Synchronization Status
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Delivery (ACCEPTED) Driver              Driver.operationalStatus = 'AVAILABLE' or 'ON_DELIVERY'          BROKEN: Driver operationalStatus never updated.
Delivery (EN_ROUTE) Driver              Driver.operationalStatus = 'ON_DELIVERY'                         BROKEN: Driver operationalStatus never updated.
Delivery (COMPL/CAN)Driver              Driver.operationalStatus returns to 'AVAILABLE' / 'OFFLINE'      BROKEN: Driver operationalStatus never updated.
Emergency (SOS)     Driver              Driver.operationalStatus = 'EMERGENCY'                           BROKEN: Emergencies module completely absent.
Delivery (CANCELLED)Route               No routes can be recommended or selected for delivery            BROKEN: RoutesDomainService permits route mutation.
User (SUSPENDED)    Session & Sockets   Immediate disconnect of active WebSocket & revocation of tokens  VERIFIED: Handled via Redis Pub/Sub & guard check.
Stop (DELIVERED)    Delivery            If all stops terminal, Delivery auto-completes                   VERIFIED: completeDeliveryIfEligible works.
Outbox Sync         DeliveryConflict    If delivery CANCELLED on server, create conflict ticket          PARTIAL: Only handles CANCELLED; drops COMPLETED.
```

---

## 9. Requirement $\rightarrow$ Invariant $\rightarrow$ Implementation $\rightarrow$ Test Traceability

| Requirement ID | Business Invariant | Implementation File | Mutation Channel | Current Test Coverage | Status / Gap |
|---|---|---|---|---|---|
| `SEC-002` | Organization-level multi-tenancy scoping | Missing in `schema.prisma` & services | REST & WS | None | **GAP (P1)** |
| `FR-RTSEC-03/04` | Nonce & sequence replay protection on WebRTC | `RealtimeGateway` (lines 578-650) | WebSocket Gateway | `ws-webrtc-signaling.e2e-spec.ts` (Weak: tests happy path only) | **WEAK TEST & GAP (P0)** |
| `FR-EMG-01..04` | SOS panic alert trigger, broadcast & resolution | None (`src/modules/emergencies` missing) | REST & WS | None | **GAP (P1)** |
| `FR-DEL-05` | Delivery termination forbids stop & route changes | `deliveries.service.ts`, `routes-domain.service.ts` | REST | Covered for Stops; NOT covered for Routes | **GAP (P0)** |
| `FR-DRV-02` | Driver operational status transitions with delivery | `deliveries.service.ts` | REST | None | **GAP (P1)** |
| `NFR-REL-02` | Transactional outbox event publishing | None (`src/modules/deliveries/services/`) | Internal / Redis | None | **GAP (P2)** |
| `DATA-PRIV-001` | 90-day GPS purge and expired session retention | None (`src/modules/retention/`) | Cron / CLI | `partition-lifecycle.e2e-spec.ts` (Manual SQL test only) | **GAP (P2)** |

---

## 10. Classified Review Output & Remediation Register

### [P0] Finding 1: WebRTC Signaling Vulnerable to Replay & Session Hijacking
- **Location:** `src/modules/realtime/gateways/realtime.gateway.ts` (lines 578-650), `src/modules/communication/dto/webrtc-signal-ws.dto.ts`
- **Affected Flow:** Live WebRTC audio/video call negotiation between Owner and Driver.
- **Root Cause:** DTOs accept raw SDP without `nonce`, monotonic `seq`, or `timestamp` skew check. No Redis replay cache check.
- **Exploit / Failure Scenario:** A malicious observer or compromised client can replay captured offer/answer SDPs, forcing renegotiation failure, infinite reconnect loops, or media disconnection during critical delivery communications.
- **Systemic Impact:** Complete denial of service of real-time communication subsystem.
- **Remediation:** Enforce `WebrtcSignalingBaseDto` requiring `nonce` (UUIDv4), `seq` (strictly increasing uint32), and `timestamp` ($\pm 30\text{s}$). Atomically claim nonce in Redis (`SET replay:nonce:<sessionId>:<nonce> 1 EX 60 NX`) and verify `seq > lastSeq`.
- **Regression Risk:** Low; requires client updates to attach headers.
- **Required Verification Tests:** E2E test sending duplicate nonce and out-of-order sequence, asserting `REPLAY_DETECTED` and `OUT_OF_ORDER_SEQUENCE` WsExceptions.

### [P0] Finding 2: Route Optimization & Selection Allowed on Terminal Deliveries
- **Location:** `src/modules/routes/services/routes-domain.service.ts` (methods `recommendRoute`, `selectRoute`, `reorderStops`)
- **Affected Flow:** Delivery route planning and manual stop reordering.
- **Root Cause:** `verifyDeliveryAccess` validates object ownership, but neglects to check whether `delivery.status` is in `['COMPLETED', 'CANCELLED', 'FAILED']`.
- **Exploit / Failure Scenario:** An operator reorders stops or applies a new route to an already cancelled or delivered consignment, mutating stop sequences in the database and triggering phantom `delivery.route.updated` WebSocket events to drivers.
- **Systemic Impact:** Database corruption of historical completed deliveries and confusion on mobile driver displays.
- **Remediation:** Add `ensureDeliveryOperational(delivery.status)` check to `recommendRoute`, `selectRoute`, and `reorderStops`, throwing `409 ConflictException` (`INVALID_DELIVERY_STATE`).
- **Regression Risk:** None. Enforces core domain rule.
- **Required Verification Tests:** E2E tests asserting 409 Conflict when attempting to reorder or select routes on `CANCELLED` and `COMPLETED` deliveries.

### [P1] Finding 3: Cross-Company Fleet & Resource Exposure (Multi-Tenancy Gap)
- **Location:** `prisma/schema.prisma`, `src/modules/fleet/fleet.service.ts`, `src/modules/deliveries/services/deliveries.service.ts`
- **Affected Flow:** Fleet live map, driver listing, and delivery assignment.
- **Root Cause:** Absence of `Organization` model and `organizationId` foreign key scoping.
- **Exploit / Failure Scenario:** Company A logs into the DMS portal and immediately monitors Company B's drivers, deliveries, and vehicles in real time via `GET /v1/fleet/locations`.
- **Systemic Impact:** Catastrophic data breach violating privacy regulations (UU PDP / GDPR) and multi-tenant security architecture.
- **Remediation:** Add `Organization` model to Prisma, add `organizationId` to `User`, `Driver`, `Vehicle`, `Delivery`. Enforce strict organization boundary filters across all queries and WebSocket room authorizers.
- **Regression Risk:** High. Requires database migration and updates to multiple service queries and E2E setup helpers.
- **Required Verification Tests:** Multi-tenant E2E suite demonstrating two isolated organizations where Company A cannot view or mutate Company B's entities.

### [P1] Finding 4: Emergency / SOS Panic Subsystem Entirely Absent from Runtime
- **Location:** `src/app.module.ts`, `src/modules/emergencies/`
- **Affected Flow:** Driver distress alert, real-time panic broadcast, and dispatcher resolution.
- **Root Cause:** Tables exist in Prisma and PostgreSQL migrations, but NestJS controller, service, and WebSocket gateways were never developed.
- **Exploit / Failure Scenario:** Driver involved in an armed hijacking or accident presses SOS on mobile app; request returns HTTP 404.
- **Systemic Impact:** Life safety hazard and breach of logistics SLA requirements.
- **Remediation:** Implement `EmergenciesModule` with `POST /v1/me/emergencies`, `GET /v1/emergencies`, `PATCH /v1/emergencies/:id/status`, real-time alert emission, and operational status transition.
- **Regression Risk:** Low. Independent new module.
- **Required Verification Tests:** Full lifecycle E2E test verifying driver SOS trigger, dispatcher acknowledgment, resolution, and driver operational status restoration.

### [P1] Finding 5: Driver Operational Status Disconnect
- **Location:** `src/modules/deliveries/services/deliveries.service.ts`
- **Affected Flow:** Driver availability tracking and dispatching.
- **Root Cause:** Delivery acceptance and start do not update `Driver.operationalStatus` to `ON_DELIVERY`, nor revert to `AVAILABLE` upon completion.
- **Exploit / Failure Scenario:** Driver on an active 10-stop route appears as `AVAILABLE` on dispatcher screens, leading to accidental double-assignment or inaccurate fleet metrics.
- **Systemic Impact:** Inconsistent fleet management state across the platform.
- **Remediation:** Update `Driver.operationalStatus` in Prisma transactions when delivery transitions to `EN_ROUTE`, `COMPLETED`, or `CANCELLED`.
- **Regression Risk:** Low.
- **Required Verification Tests:** E2E test validating `Driver.operationalStatus` changes in lockstep with delivery lifecycle.

### [P2] Finding 6: Dual-Write Inconsistency (Missing Transactional Outbox)
- **Location:** `src/modules/deliveries/services/deliveries.service.ts`, `src/modules/realtime/gateways/realtime.gateway.ts`
- **Affected Flow:** Realtime WebSocket broadcast on delivery and stop mutations.
- **Root Cause:** Realtime events are published directly to Redis after database commit without outbox persistence.
- **Exploit / Failure Scenario:** Transient network partition or Redis restart during high-volume delivery operations causes silent loss of status events; dispatchers see stale data.
- **Systemic Impact:** Realtime desynchronization requiring manual page reloads.
- **Remediation:** Introduce `outbox_events` table in PostgreSQL; persist event during entity transaction; drain via scheduled relay worker using `SELECT ... FOR UPDATE SKIP LOCKED`.
- **Regression Risk:** Low.
- **Required Verification Tests:** E2E test verifying outbox event insertion and relay publisher execution under simulated Redis failure.

### [P2] Finding 7: Missing Automated Data Retention & Privacy Purge
- **Location:** `src/modules/retention/`
- **Affected Flow:** Storage management and privacy compliance.
- **Root Cause:** No background cron or worker purges expired idempotency records, old GPS tracking partitions, or revoked sessions.
- **Exploit / Failure Scenario:** Unchecked growth of `location_points` and `idempotency_records` degrades database performance over 6-12 months.
- **Systemic Impact:** Operational degradation and non-compliance with data retention policies.
- **Remediation:** Implement `RetentionService` executing daily scheduled batched deletes and audit logging.
- **Regression Risk:** Low.
- **Required Verification Tests:** Unit and integration tests validating retention threshold logic and purge counts.

---

## 11. Ponytail Principles for Next-Phase Implementation

When code implementation is authorized in the subsequent phase, all remediation work will strictly adhere to the **`ponytail`** skill (Level: Full):
1. **Zero Unrequested Abstractions:** No generic repository layers, no speculative factory classes, no unnecessary event buses.
2. **Native PostgreSQL & Redis First:** Utilize native PostgreSQL constraints (`CHECK`, `UNIQUE`), `SELECT FOR UPDATE SKIP LOCKED` for the outbox relay, and atomic Redis commands (`SET NX EX`) for replay protection.
3. **Shortest Correct Diff:** Fix root causes cleanly where all callers route through.
4. **Single Runnable Test Check:** One robust, runnable test suite per non-trivial branch.
