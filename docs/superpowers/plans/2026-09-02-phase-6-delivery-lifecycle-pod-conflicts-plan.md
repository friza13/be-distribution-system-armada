# Phase 6: Delivery Lifecycle, POD & Conflicts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun state machine siklus hidup pengiriman (`Delivery` & `DeliveryStop`), ingesti bukti pengiriman aman (*POD*), penyimpanan file privat (*Local Private File Storage Adapter*), ingesti batch outbox offline (`POST /v1/me/sync/outbox`), engine resolusi konflik deterministik berbasis *Authority Matrix*, serta penyiaran realtime via WebSocket.

**Architecture:** NestJS `DeliveriesModule`, `PodModule`, `DeliveriesService`, `DeliveryStopsService`, `PodService`, `LocalPrivateStorageAdapter`, `DeliveryConflictsService`, `RealtimeGateway`.

**Tech Stack:** Node.js 22 LTS, NestJS 10, Prisma 5.22.0, PostgreSQL 16 + PostGIS 3.4, Redis 7, Socket.IO 4.

---

## Global Constraints

- **No Database Migration Required:** Skema database `deliveries`, `delivery_stops`, `proof_of_delivery`, `files`, `delivery_conflicts`, `delivery_events`, `idempotency_records` dari Phase 1 sudah 100% mendukung.
- **Strict Role & IDOR Guards:** Driver hanya dapat membaca & memodifikasi delivery/stop/POD yang ditugaskan padanya.
- **Completion Invariant:** Delivery `COMPLETED` jika SELURUH stop terminal (`DELIVERED`, `FAILED`, `SKIPPED`) dan $\ge 1$ stop `DELIVERED`.
- **Zero Public File URL:** File POD diunduh strictly via `GET /v1/files/:id/download` terotentikasi.

---

## File Structure Map

```text
backend/
├── src/
│   └── modules/
│       ├── deliveries/
│       │   ├── dto/
│       │   │   ├── create-delivery.dto.ts          [CREATE - Task 6.1]
│       │   │   ├── assign-delivery.dto.ts          [CREATE - Task 6.1]
│       │   │   ├── delivery-status.dto.ts          [CREATE - Task 6.1]
│       │   │   └── stop-status.dto.ts              [CREATE - Task 6.2]
│       │   ├── services/
│       │   │   ├── deliveries.service.ts           [CREATE - Task 6.1]
│       │   │   ├── delivery-stops.service.ts       [CREATE - Task 6.2]
│       │   │   └── delivery-conflicts.service.ts   [CREATE - Task 6.4]
│       │   ├── deliveries.controller.ts            [MODIFY - Task 6.1, 6.2]
│       │   ├── conflicts.controller.ts             [CREATE - Task 6.4]
│       │   └── deliveries.module.ts                [MODIFY - Task 6.1]
│       └── pod/
│           ├── dto/
│           │   ├── submit-pod.dto.ts               [CREATE - Task 6.3]
│           │   └── upload-file.dto.ts              [CREATE - Task 6.3]
│           ├── services/
│           │   ├── pod.service.ts                  [CREATE - Task 6.3]
│           │   └── file-storage.service.ts         [CREATE - Task 6.3]
│           ├── pod.controller.ts                   [CREATE - Task 6.3]
│           └── pod.module.ts                       [CREATE - Task 6.3]
└── test/
    └── deliveries/
        ├── delivery-state-machine.e2e-spec.ts      [CREATE - Task 6.1]
        ├── stop-lifecycle.e2e-spec.ts              [CREATE - Task 6.2]
        ├── pod-upload.e2e-spec.ts                  [CREATE - Task 6.3]
        └── offline-conflicts.e2e-spec.ts           [CREATE - Task 6.4]
```

---

## Task Breakdown & Bite-Sized Steps

---

### Task 6.1: Delivery Management & State Machine Engine (`DELIVERY-001`)

- [ ] **Step 1: DTOs & Validation**
  Create `create-delivery.dto.ts`, `assign-delivery.dto.ts`, `delivery-status.dto.ts`.

- [ ] **Step 2: `DeliveriesService`**
  Implement `createDelivery`, `assignDelivery`, `acceptDelivery`, `startDelivery`, `completeDelivery`, `cancelDelivery`, and `evaluateDeliveryCompletion`.

- [ ] **Step 3: `DeliveriesController` & `DeliveriesModule`**
  Add endpoints and register in `AppModule`.

- [ ] **Step 4: E2E Test `delivery-state-machine.e2e-spec.ts`**

---

### Task 6.2: DeliveryStop Lifecycle & Transition Service (`DELIVERY-002`)

- [ ] **Step 1: DTO `stop-status.dto.ts`**

- [ ] **Step 2: `DeliveryStopsService`**
  Implement `departToStop`, `arriveAtStop`, `startUnloading`, `failStop`, `skipStop`. Trigger `evaluateDeliveryCompletion` on terminal transitions.

- [ ] **Step 3: Controller Endpoints & E2E Test `stop-lifecycle.e2e-spec.ts`**

---

### Task 6.3: Secure File Upload & Proof of Delivery (POD) Service (`DELIVERY-003`)

- [ ] **Step 1: File Storage Adapter & Pipe**
  Implement `LocalPrivateStorageAdapter` with magic bytes validation and size cap (5MB photo, 500KB sig).

- [ ] **Step 2: `PodService` & `PodController`**
  Implement `POST /v1/files/upload`, `GET /v1/files/:id/download`, `POST /v1/me/stops/:id/pod`, `GET /v1/deliveries/:id/pod`.

- [ ] **Step 3: E2E Test `pod-upload.e2e-spec.ts`**

---

### Task 6.4: Offline Outbox Sync & Deterministic Conflict Engine (`DELIVERY-004`)

- [ ] **Step 1: `DeliveryConflictsService` & `ConflictsController`**
  Implement `POST /v1/me/sync/outbox`, `GET /v1/conflicts`, `POST /v1/conflicts/:id/resolve`.

- [ ] **Step 2: E2E Test `offline-conflicts.e2e-spec.ts`**

---

### Task 6.5: Realtime Status Propagation & Living API Contracts (`DELIVERY-005`)

- [ ] **Step 1: Broadcast events `delivery.status_changed`, `delivery.stop.status_changed`, `delivery.pod.created` to room `delivery:<id>`**
- [ ] **Step 2: Update API contracts & `openapi.yaml`**
- [ ] **Step 3: Full regression & build verification**
