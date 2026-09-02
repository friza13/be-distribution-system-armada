# Phase 6: Delivery Lifecycle, POD & Conflicts — Task Breakdown

**Version:** 1.0.0
**Status:** APPROVED — READY FOR IMPLEMENTATION
**Date:** 2026-09-02
**Target Milestone:** Phase 6 Execution

---

## 1. Task Breakdown Matrix

| Task ID | Task Title | Primary Components | Dependencies | Test Coverage |
|---|---|---|---|---|
| **`DELIVERY-001`** | Delivery Management & State Machine Engine | `DeliveriesService`, `deliveries.controller.ts`, DTOs (`create-delivery`, `assign-delivery`, `status-update`), `evaluateDeliveryCompletion` | Phase 2 Auth, Phase 4 Telemetry | `delivery-state-machine.e2e-spec.ts` |
| **`DELIVERY-002`** | DeliveryStop Lifecycle & Transition Subsystem | `DeliveryStopsService`, `stop-status.dto.ts`, `DeliveryEvent` outbox logger | `DELIVERY-001` | `stop-lifecycle.e2e-spec.ts` |
| **`DELIVERY-003`** | Secure File Upload & Proof of Delivery (POD) Service | `PodModule`, `PodService`, `FileStorageService`, `LocalPrivateStorageAdapter`, `submit-pod.dto.ts` | `DELIVERY-002`, File Storage | `pod-upload.e2e-spec.ts` |
| **`DELIVERY-004`** | Offline Outbox Sync & Deterministic Conflict Engine | `DeliveryConflictsService`, `conflicts.controller.ts`, `outbox-sync.dto.ts`, `resolve-conflict.dto.ts` | `DELIVERY-003` | `offline-conflicts.e2e-spec.ts` |
| **`DELIVERY-005`** | Realtime Status Propagation & Living API Contracts | `RealtimeGateway` events (`delivery.status_changed`, `delivery.stop.status_changed`, `delivery.pod.created`), API contracts & OpenAPI finalization | `DELIVERY-004`, Phase 3 Realtime | `ws-delivery-realtime.e2e-spec.ts` |

---

## 2. Dependency Map & Critical Path

```mermaid
flowchart TD
    subgraph Phase2["Phase 2 (CLOSED)"]
        AuthGuard["JwtAuthGuard + IDOR Defense"]
    end

    subgraph Phase3["Phase 3 (CLOSED)"]
        Gateway["RealtimeGateway (/v1/realtime)"]
        DeliveryRoom["delivery:<deliveryId> room"]
    end

    subgraph Task61["Task 6.1 (DELIVERY-001)"]
        DeliveriesSvc["DeliveriesService & State Machine Evaluator"]
        DeliveriesCtrl["POST /v1/deliveries & status endpoints"]
    end

    subgraph Task62["Task 6.2 (DELIVERY-002)"]
        StopsSvc["DeliveryStopsService & Stop State Machine"]
        StopsCtrl["POST /v1/me/stops/:id/* endpoints"]
    end

    subgraph Task63["Task 6.3 (DELIVERY-003)"]
        StorageAdapter["LocalPrivateStorageAdapter (Magic Bytes & Size)"]
        PodSvc["PodService & FileRecordService"]
        PodCtrl["POST /v1/files/upload + POST /v1/me/stops/:id/pod"]
    end

    subgraph Task64["Task 6.4 (DELIVERY-004)"]
        SyncSvc["DeliveryConflictsService & Outbox Batch Ingestion"]
        ConflictCtrl["POST /v1/me/sync/outbox + /v1/conflicts/:id/resolve"]
    end

    subgraph Task65["Task 6.5 (DELIVERY-005)"]
        Broadcast["Realtime Broadcast status_changed & pod.created"]
        APIDocs["DELIVERY-LIFECYCLE-API-CONTRACT.md, POD-API-CONTRACT.md & openapi.yaml"]
    end

    AuthGuard --> DeliveriesCtrl
    DeliveriesSvc --> DeliveriesCtrl

    DeliveriesSvc --> StopsSvc
    StopsSvc --> StopsCtrl

    StopsSvc --> StorageAdapter
    StorageAdapter --> PodSvc
    PodSvc --> PodCtrl

    PodSvc --> SyncSvc
    SyncSvc --> ConflictCtrl

    SyncSvc --> Broadcast
    Gateway --> Broadcast
    DeliveryRoom --> Broadcast
    SyncSvc --> APIDocs
```

**Critical Path:** `DELIVERY-001` $\rightarrow$ `DELIVERY-002` $\rightarrow$ `DELIVERY-003` $\rightarrow$ `DELIVERY-004` $\rightarrow$ `DELIVERY-005`.
