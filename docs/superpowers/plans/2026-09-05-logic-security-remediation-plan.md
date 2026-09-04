# Implementation Plan: Logic, Security & Architectural Remediation (Hardened & Refined)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> **Execution Directive:** All coding actions in the implementation phase must adhere to the **`ponytail`** skill (Level: Full): the laziest, shortest, cleanest working solution with native/stdlib primitives, zero speculative abstractions, and robust TDD verification.

**Goal:** Remediate all P0, P1, and P2 architectural, logic, and security findings identified in the 2026-09-05 review, bringing the system to a hardened, fully compliant, production-ready state.

**Architecture:** Modular Monolith in NestJS 10, Prisma ORM 5.22, PostgreSQL 16 + PostGIS, Redis 7 (ioredis).

**Tech Stack:** Node.js 22 LTS, TypeScript strict mode, NestJS, Prisma ORM, Redis, Jest, Supertest.

**Spec:** `docs/superpowers/specs/2026-09-05-logic-security-remediation-design.md`  
**Audit Baseline:** `docs/reports/2026-09-05-GAP-AND-SECURITY-REMEDIATION-REVIEW.md`

## Global Constraints

- **Language & Runtime:** Node.js 22 LTS with TypeScript strict mode.
- **ORM:** Prisma 5.22.0 strictly pinned; zero hand-crafted divergent schemas.
- **Testing Standard:** Every task must strictly follow TDD (failing test first $\rightarrow$ minimal code $\rightarrow$ green test $\rightarrow$ git commit).
- **Security:** Zero plaintext credentials/keys in logs, responses, or migrations.
- **Ponytail Guideline:** Native DB constraints over application boilerplate; no external queue libraries when native PostgreSQL `SKIP LOCKED` suffices; one clean, robust test per non-trivial branch.

---

## File Structure Map

```text
prisma/
├── schema.prisma (updated: Organization, OutboxEvent, foreign keys)
└── migrations/
    └── 20260905000001_remediation_organizations_and_outbox/migration.sql

scripts/
└── bootstrap-superadmin.ts (new: zero-leak CLI bootstrap)

src/
├── common/
│   ├── decorators/
│   │   └── current-org.decorator.ts (new: extracts organizationId)
│   └── guards/
│       └── org-scope.guard.ts (new: verifies organization boundary)
├── modules/
│   ├── auth/
│   │   ├── dto/
│   │   │   └── register-user.dto.ts (updated: organization code/id support)
│   │   └── auth.service.ts (updated: org assignment)
│   ├── users/
│   │   ├── dto/
│   │   │   └── activate-driver.dto.ts (new)
│   │   ├── users.controller.ts (updated: pending-drivers & activate-driver)
│   │   └── users.service.ts (updated: driver profile creation transaction)
│   ├── fleet/
│   │   └── fleet.service.ts (updated: organization scoping)
│   ├── deliveries/
│   │   └── services/
│   │       ├── deliveries.service.ts (updated: organization scoping & driver operational status sync)
│   │       └── delivery-outbox.service.ts (new: transactional outbox publisher)
│   ├── routes/
│   │   └── services/
│   │       └── routes-domain.service.ts (updated: terminal delivery invariant lock)
│   ├── realtime/
│   │   ├── gateways/
│   │   │   └── realtime.gateway.ts (updated: nonce & sequence replay verification)
│   │   └── services/
│   │       └── ws-room-authorizer.service.ts (updated: org room checks)
│   ├── communication/
│   │   └── dto/
│   │       └── webrtc-signal-ws.dto.ts (updated: nonce, seq, timestamp)
│   ├── emergencies/ (new module)
│   │   ├── dto/
│   │   │   ├── trigger-emergency.dto.ts (new)
│   │   │   ├── update-emergency-status.dto.ts (new)
│   │   │   └── query-emergency.dto.ts (new)
│   │   ├── emergencies.controller.ts (new)
│   │   ├── emergencies.service.ts (new)
│   │   └── emergencies.module.ts (new)
│   └── retention/ (new module)
│       ├── retention.service.ts (new: scheduled privacy purge)
│       └── retention.module.ts (new)

test/
├── emergencies/
│   └── emergencies.e2e-spec.ts (new)
├── auth/
│   └── driver-activation.e2e-spec.ts (new)
├── realtime/
│   └── webrtc-replay-defense.e2e-spec.ts (new)
├── routes/
│   └── route-terminal-guard.e2e-spec.ts (new)
├── deliveries/
│   └── driver-status-sync.e2e-spec.ts (new)
└── retention/
    └── retention-purge.spec.ts (new)
```

---

## Tasks Breakdown

### Task 1: Terminal Delivery Guard on Route Optimization & Reordering (P0)

**Files:**
- Modify: `src/modules/routes/services/routes-domain.service.ts`
- Test: `test/routes/route-terminal-guard.e2e-spec.ts`

**Interfaces:**
- Consumes: `delivery.status` in `recommendRoute`, `selectRoute`, `reorderStops`.
- Produces: Throws 409 `ConflictException` (`INVALID_DELIVERY_STATE`) if delivery status is `COMPLETED`, `CANCELLED`, or `FAILED`.

- [ ] **Step 1: Write the failing terminal delivery route test**
  Write an E2E test verifying that calling `POST /v1/deliveries/:id/routes/reorder` or `select` on a `CANCELLED` delivery rejects with 409 Conflict.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npm run test:e2e -- test/routes/route-terminal-guard.e2e-spec.ts`
  Expected: FAIL (route reordered successfully).
- [ ] **Step 3: Implement minimal terminal guard in RoutesDomainService**
  Add `ensureDeliveryOperational(delivery.status)` check before acquiring mutation lock in `recommendRoute`, `selectRoute`, and `reorderStops`.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npm run test:e2e -- test/routes/route-terminal-guard.e2e-spec.ts`
  Expected: PASS.
- [ ] **Step 5: Commit changes**
  ```bash
  git add src/modules/routes/ test/routes/
  git commit -m "fix(routes): forbid route recommendation and reordering on terminal deliveries"
  ```

---

### Task 2: WebRTC Signaling Nonce & Monotonic Sequence Replay Defense (P0)

**Files:**
- Modify: `src/modules/communication/dto/webrtc-signal-ws.dto.ts`
- Modify: `src/modules/realtime/gateways/realtime.gateway.ts`
- Test: `test/realtime/webrtc-replay-defense.e2e-spec.ts`

**Interfaces:**
- Consumes: `WebrtcOfferWsDto`, `WebrtcAnswerWsDto`, `WebrtcIceCandidateWsDto` (with `nonce`, `seq`, `timestamp`).
- Produces: Atomic Redis replay protection rejecting duplicated or out-of-order signaling messages.

- [ ] **Step 1: Write the failing replay defense test**
  Send a valid `webrtc.signal.offer` via WebSocket. Re-send the exact same payload with identical `nonce`. Verify socket receives `call_error` (`REPLAY_DETECTED`).
- [ ] **Step 2: Run test to verify it fails**
  Run: `npm run test:e2e -- test/realtime/webrtc-replay-defense.e2e-spec.ts`
  Expected: FAIL (second message currently accepted).
- [ ] **Step 3: Implement minimal Redis atomic nonce and seq check**
  In `RealtimeGateway`: validate timestamp skew ($\le 30\text{s}$), check `SET replay:nonce:... NX EX 60`, and verify `seq > lastSeq`.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npm run test:e2e -- test/realtime/webrtc-replay-defense.e2e-spec.ts`
  Expected: PASS.
- [ ] **Step 5: Commit changes**
  ```bash
  git add src/modules/communication/ src/modules/realtime/ test/realtime/
  git commit -m "feat(realtime): add atomic nonce and monotonic sequence replay protection to WebRTC signaling"
  ```

---

### Task 3: Schema Migration — Organizations & Outbox Events (P1)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260905000001_remediation_organizations_and_outbox/migration.sql`
- Test: `test/database/schema-remediation.e2e-spec.ts`

**Interfaces:**
- Produces: `Organization` model, `OutboxEvent` model, and relations on `User`, `Driver`, `Vehicle`, `Delivery`.

- [ ] **Step 1: Write the failing schema test**
  Write an E2E test verifying that an `Organization` record can be created, a `User` can be linked to it, and an `OutboxEvent` record can be inserted.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npm run test:e2e -- test/database/schema-remediation.e2e-spec.ts`
  Expected: FAIL with "Cannot find model Organization".
- [ ] **Step 3: Update schema.prisma and create migration**
  Add `Organization` and `OutboxEvent` models to `prisma/schema.prisma` with foreign keys and unique constraints.
  Generate and apply migration via Prisma CLI.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npm run test:e2e -- test/database/schema-remediation.e2e-spec.ts`
  Expected: PASS.
- [ ] **Step 5: Commit changes**
  ```bash
  git add prisma/ test/database/schema-remediation.e2e-spec.ts
  git commit -m "feat(database): add organizations and outbox events models"
  ```

---

### Task 4: Multi-Tenancy Scoping in Fleet & Delivery Services (P1)

**Files:**
- Modify: `src/modules/fleet/fleet.service.ts`
- Modify: `src/modules/deliveries/services/deliveries.service.ts`
- Modify: `src/modules/realtime/services/ws-room-authorizer.service.ts`
- Test: `test/fleet/fleet-isolation.e2e-spec.ts`

**Interfaces:**
- Consumes: `req.user.organizationId`
- Produces: Strictly filtered driver locations and deliveries by organization.

- [ ] **Step 1: Write the failing multi-tenant isolation test**
  Create two organizations (`Org A` and `Org B`) with active drivers in each. Test that Owner A calling `GET /v1/fleet/locations` receives ONLY Org A drivers.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npm run test:e2e -- test/fleet/fleet-isolation.e2e-spec.ts`
  Expected: FAIL with cross-organization driver leakage.
- [ ] **Step 3: Implement minimal organization filtering**
  Update `FleetService.getAllActiveDriverLocations`, `DeliveriesService.getDeliveryById`, and `WsRoomAuthorizerService` to filter by `actor.organizationId`.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npm run test:e2e -- test/fleet/fleet-isolation.e2e-spec.ts`
  Expected: PASS.
- [ ] **Step 5: Commit changes**
  ```bash
  git add src/modules/fleet/ src/modules/deliveries/ src/modules/realtime/ test/fleet/
  git commit -m "fix(security): enforce organization-level tenant isolation across fleet and deliveries"
  ```

---

### Task 5: Emergency (SOS) Management Subsystem (P1)

**Files:**
- Create: `src/modules/emergencies/dto/trigger-emergency.dto.ts`
- Create: `src/modules/emergencies/dto/update-emergency-status.dto.ts`
- Create: `src/modules/emergencies/emergencies.service.ts`
- Create: `src/modules/emergencies/emergencies.controller.ts`
- Create: `src/modules/emergencies/emergencies.module.ts`
- Modify: `src/app.module.ts`
- Test: `test/emergencies/emergencies.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /v1/me/emergencies`, `GET /v1/emergencies`, `PATCH /v1/emergencies/:id/status`. Emits `emergency.triggered` event to WebSocket.

- [ ] **Step 1: Write the failing emergency lifecycle test**
  Driver triggers SOS (`POST /v1/me/emergencies`). Verify response status 201, `driver.operationalStatus = 'EMERGENCY'`, and owner receives event. Owner acknowledges and resolves it (`PATCH /v1/emergencies/:id/status`), verifying driver operational status is restored.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npm run test:e2e -- test/emergencies/emergencies.e2e-spec.ts`
  Expected: FAIL (module not defined).
- [ ] **Step 3: Implement EmergenciesModule**
  Build minimal controller, service, and DTOs using native Prisma `Emergency` model and PostGIS spatial point auto-sync.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npm run test:e2e -- test/emergencies/emergencies.e2e-spec.ts`
  Expected: PASS.
- [ ] **Step 5: Commit changes**
  ```bash
  git add src/modules/emergencies/ src/app.module.ts test/emergencies/
  git commit -m "feat(emergencies): implement SOS trigger, lifecycle state machine, and real-time alerts"
  ```

---

### Task 6: Driver Operational Status Invariant Synchronization (P1)

**Files:**
- Modify: `src/modules/deliveries/services/deliveries.service.ts`
- Test: `test/deliveries/driver-status-sync.e2e-spec.ts`

**Interfaces:**
- Consumes: Delivery status transitions (`startDelivery`, `completeDelivery`, `cancelDelivery`).
- Produces: Atomic updates to `Driver.operationalStatus` (`ON_DELIVERY`, `AVAILABLE`).

- [ ] **Step 1: Write the failing driver status sync test**
  Driver starts delivery (`POST /v1/deliveries/:id/start`). Verify `Driver.operationalStatus` is updated to `ON_DELIVERY`. Upon completion, verify it reverts to `AVAILABLE`.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npm run test:e2e -- test/deliveries/driver-status-sync.e2e-spec.ts`
  Expected: FAIL (status remains AVAILABLE during delivery).
- [ ] **Step 3: Implement operational status updates in DeliveriesService**
  Inside Prisma transactions, update `driver.operationalStatus = 'ON_DELIVERY'` on start, and `'AVAILABLE'` on completion or cancellation.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npm run test:e2e -- test/deliveries/driver-status-sync.e2e-spec.ts`
  Expected: PASS.
- [ ] **Step 5: Commit changes**
  ```bash
  git add src/modules/deliveries/ test/deliveries/
  git commit -m "fix(deliveries): synchronize driver operational status with delivery lifecycle"
  ```

---

### Task 7: Driver Activation Workflow & Secure Admin CLI Bootstrap (P2)

**Files:**
- Create: `src/modules/users/dto/activate-driver.dto.ts`
- Modify: `src/modules/users/users.controller.ts`
- Modify: `src/modules/users/users.service.ts`
- Create: `scripts/bootstrap-superadmin.ts`
- Test: `test/auth/driver-activation.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /v1/users/pending-drivers`, `POST /v1/users/:id/activate-driver`, and CLI bootstrap script.

- [ ] **Step 1: Write the failing driver activation test**
  Register a user (`PENDING_ACTIVATION`). Call `POST /v1/users/:id/activate-driver` as Admin with `employeeCode` and `displayName`. Assert user becomes `ACTIVE` and `Driver` entity is created.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npm run test:e2e -- test/auth/driver-activation.e2e-spec.ts`
  Expected: FAIL (404 route not found).
- [ ] **Step 3: Implement driver activation service & controller endpoints**
  In `UsersService`: add `getPendingDrivers` and `activateDriver` within a Prisma transaction.
  In `scripts/bootstrap-superadmin.ts`: implement idempotent Super Admin creation from environment variables.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npm run test:e2e -- test/auth/driver-activation.e2e-spec.ts`
  Expected: PASS.
- [ ] **Step 5: Commit changes**
  ```bash
  git add src/modules/users/ scripts/ test/auth/
  git commit -m "feat(users): add pending driver activation workflow and idempotent superadmin bootstrap"
  ```

---

### Task 8: Transactional Realtime Event Outbox & Privacy Retention Purge (P2)

**Files:**
- Create: `src/modules/deliveries/services/delivery-outbox.service.ts`
- Create: `src/modules/retention/retention.service.ts`
- Create: `src/modules/retention/retention.module.ts`
- Modify: `src/modules/deliveries/services/deliveries.service.ts`
- Modify: `src/app.module.ts`
- Test: `test/retention/retention-purge.spec.ts`
- Test: `test/deliveries/outbox-durability.e2e-spec.ts`

**Interfaces:**
- Produces: Resilient transactional event delivery across Redis failures and automated cleanup of expired tokens/points.

- [ ] **Step 1: Write the failing outbox and retention tests**
  Test 1: Transaction commits state and outbox record; outbox relay publishes to Redis.
  Test 2: `RetentionService.purgeExpiredRecords()` prunes records older than threshold and returns accurate deleted counts.
- [ ] **Step 2: Run tests to verify they fail**
  Run: `npm run test -- test/retention/retention-purge.spec.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement Outbox Relay and Retention Service**
  Implement minimal native SQL queries with `SKIP LOCKED` for outbox polling and batch deletion for retention cleanup.
- [ ] **Step 4: Run tests to verify they pass**
  Run: `npm run test && npm run test:e2e`
  Expected: ALL PASS.
- [ ] **Step 5: Commit changes**
  ```bash
  git add src/modules/retention/ src/modules/deliveries/ src/app.module.ts test/
  git commit -m "feat(reliability): implement transactional event outbox and automated data retention purge"
  ```

---

## Final Verification Checklist

After completing all tasks:
1. `npm run test` (All unit tests green).
2. `npm run test:e2e` (All E2E test suites green).
3. `npm run build` (Exit code 0, clean production build).
4. Run live route check to verify all routes adhere to API contract.
