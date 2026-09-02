# Phase 6: Delivery Lifecycle, POD & Conflicts — Reconciliation Report

**Document Version:** 1.0.0
**Date:** 2026-09-02
**Author:** AI Engineering Agent (BE & Security Lead)
**Status:** APPROVED & EXECUTING

---

## 1. Executive Summary

Phase 6 membangun state machine siklus hidup pengiriman (`Delivery` & `DeliveryStop`), ingesti bukti pengiriman aman (*Proof of Delivery / POD*), penyimpanan file privat (*Local Private File Storage Adapter*), ingesti batch outbox offline (`POST /v1/me/sync/outbox`), engine resolusi konflik deterministik berbasis *Authority Matrix*, serta penyiaran realtime via WebSocket saat status pengiriman berubah.

---

## 2. Completed Milestones Baseline (Phase 0–5)

```text
Phase 0: Foundation & Core Scaffold          --> [CLOSED & VERIFIED] (8bd990c)
Phase 1: Database & PostGIS Spatial Core     --> [CLOSED & VERIFIED] (f69d5a5)
Phase 2: Auth, RBAC, Sessions & Key Mgmt     --> [CLOSED & VERIFIED] (6450af7)
Phase 3: Realtime Infrastructure (Socket.IO) --> [CLOSED & VERIFIED] (822d855)
Phase 4: Telemetry, GPS Streaming & Fleet    --> [CLOSED & VERIFIED] (6e7ef12)
Phase 5: Route Optimization & 2-Opt/OSRM     --> [CLOSED & VERIFIED] (7915127)
Phase 6: Delivery Lifecycle, POD & Conflicts --> [IN PROGRESS / BUILDING]
```

---

## 3. Existing Schema Audit & Verification

### 3.1 Existing Prisma Models (`prisma/schema.prisma`)

| Model / Table | Relevant Columns | Status |
|---|---|---|
| `Delivery` | `id`, `deliveryCode`, `driverId`, `vehicleId`, `status`, `routeMode`, `plannedStartAt`, `startedAt`, `completedAt`, `createdBy` | ✅ EXISTS |
| `DeliveryItem` | `id`, `deliveryId`, `itemCode`, `itemName`, `quantity`, `unit`, `weightKg`, `volumeM3` | ✅ EXISTS |
| `DeliveryStop` | `id`, `deliveryId`, `sequence`, `destinationName`, `address`, `latitude`, `longitude`, `geom`, `geofenceRadiusM`, `status`, `arrivedAt`, `completedAt` | ✅ EXISTS |
| `ProofOfDelivery` | `id`, `deliveryStopId`, `receiverName`, `signatureFileId`, `photoFileId`, `notes`, `completedAt`, `createdBy` | ✅ EXISTS (`@@unique([deliveryStopId])`) |
| `FileRecord` | `id`, `objectKey`, `mediaType`, `sizeBytes`, `checksumSha256`, `uploadedBy`, `createdAt` | ✅ EXISTS (`@@unique([objectKey])`) |
| `DeliveryConflict` | `id`, `deliveryId`, `clientEventId`, `conflictType`, `serverState`, `clientPayload`, `status`, `resolvedBy`, `resolutionNotes`, `createdAt`, `resolvedAt` | ✅ EXISTS |
| `DeliveryEvent` | `id`, `deliveryId`, `stopId`, `eventType`, `actorUserId`, `metadataJson`, `clientOccurredAt`, `occurredAt`, `receivedAt`, `idempotencyKey` | ✅ EXISTS (`@@unique([idempotencyKey])`) |

**Kesimpulan Schema Audit:**
Skema database PostgreSQL yang ada pada Phase 1 telah 100% mencukupi kebutuhan *Delivery State Machine*, *POD*, *File Records*, *Delivery Conflicts*, dan *Delivery Events*. **Tidak ada migrasi database baru yang diperlukan.**

---

## 4. Key Reconciled Architecture Decisions

1. **Private Storage Adapter Strategy:**
   - Provider: `LocalPrivateStorageAdapter` menyimpan file ke direktori privat `backend/storage/private/pod/{year}/{month}/{uuid}.jpg`.
   - **Zero Public Bucket/URL:** Semua pengunduhan file di-guard oleh `JwtAuthGuard` + **Object-Level Ownership Check** melalui `GET /v1/files/:id/download`.
   - Validasi File: Magic bytes (JPEG, PNG, WebP), cap ukuran (5 MB foto, 500 KB signature), dan checksum SHA-256.
2. **Delivery & Stop Completion Invariant:**
   - `Delivery` HANYA BISA berpindah ke `COMPLETED` apabila **SELURUH stop berada di status terminal** (`DELIVERED`, `FAILED`, `SKIPPED`) dan $\ge 1$ stop berstatus `DELIVERED`.
   - `Delivery` TIDAK BOLEH `COMPLETED` jika masih ada stop berstatus `PENDING`, `EN_ROUTE`, `ARRIVED`, atau `UNLOADING`.
3. **POST /v1/deliveries/:id/complete Semantics:**
   - Single Evaluator Engine (`evaluateDeliveryCompletion`): Dipanggil secara otomatis saat stop terakhir selesai, atau dipanggil secara eksplisit oleh Driver/Owner/Admin.
   - Jika masih ada stop non-terminal $\rightarrow$ Menolak dengan `409 CONFLICT (UNFINISHED_STOPS_REMAIN)`.
4. **Deterministic Offline Conflict Engine:**
   - Jika Driver menyelesaikan stop secara offline namun Owner telah membatalkan delivery (`CANCELLED`) di server, bukti foto POD **TIDAK DIHAPUS**.
   - Server menyimpan bukti POD dan membuat tiket `DeliveryConflict` (`status: OPEN`).
   - Admin/Owner dapat melakukan resolusi via `POST /v1/conflicts/:id/resolve` dengan opsi `RESOLVED_OVERRIDDEN` atau `RESOLVED_DISCARDED`.
5. **Realtime Broadcast:**
   - Perubahan status delivery, status stop, dan pembuatan POD disiarkan secara otomatis ke WebSocket room `delivery:<deliveryId>`.
