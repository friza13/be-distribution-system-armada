# Phase 6: Delivery Lifecycle, POD & Conflicts — Design Specification

**Document Version:** 1.0.0
**Target Milestone:** Phase 6 Implementation Ready
**Date:** 2026-09-02
**Author:** AI Engineering Agent (BE & Security Lead)

---

## 1. Executive Summary & Goals

Phase 6 mengimplementasikan siklus hidup pengiriman terpadu (*Delivery & Stop State Machine*), modul ingesti dan penyimpanan bukti pengiriman (*Proof of Delivery / POD*), engine outbox offline & resolusi konflik deterministik (*Deterministic Conflict Engine*), serta penyiaran realtime via WebSocket saat terjadi perubahan status bisnis.

---

## 2. State Machine & Transition Matrix

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DELIVERY STATE MACHINE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ DRAFT ─────────► ASSIGNED ─────────► ACCEPTED ─────────► EN_ROUTE           │
│                    │                   │                   │                │
│                    ▼                   ▼                   ▼                │
│                CANCELLED           CANCELLED           CANCELLED            │
│                                                            │                │
│                                                ┌───────────┴───────────┐    │
│                                                ▼                       ▼    │
│                                            COMPLETED                 FAILED │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        DELIVERY STOP STATE MACHINE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ PENDING ────────► EN_ROUTE ────────► ARRIVED ────────► UNLOADING            │
│    │                                                      │                 │
│    ▼                                          ┌───────────┴───────────┐     │
│ SKIPPED                                       ▼                       ▼     │
│                                           DELIVERED                 FAILED  │
│                                        (POD Required)      (Reason Required)│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Delivery Status Transitions (`DeliveryStatus`)

| From Status | To Status | Allowed Roles | Prerequisite & Domain Constraints |
|---|---|---|---|
| `DRAFT` | `ASSIGNED` | `ADMIN`, `SUPER_ADMIN`, `OWNER` | Driver & Vehicle assigned (`driverId` & `vehicleId` non-null). |
| `ASSIGNED` | `ACCEPTED` | `DRIVER` (assigned only) | Driver confirms delivery assignment. |
| `ACCEPTED` | `EN_ROUTE` | `DRIVER` (assigned only) | Driver starts trip. Sets `startedAt = NOW()`. |
| `EN_ROUTE` | `COMPLETED` | System / Driver / Owner / Admin | Triggers when ALL stops reach terminal states (`DELIVERED`, `FAILED`, `SKIPPED`) and $\ge 1$ stop is `DELIVERED`. Sets `completedAt = NOW()`. |
| `EN_ROUTE` | `FAILED` | `DRIVER`, `OWNER`, `ADMIN` | All stops failed or unrecoverable delivery failure. |
| `ASSIGNED` / `ACCEPTED` / `EN_ROUTE` | `CANCELLED` | `ADMIN`, `SUPER_ADMIN`, `OWNER` | Operational cancellation with mandatory audit reason. |

### 2.2 Stop Status Transitions (`StopStatus`)

| From Status | To Status | Allowed Roles | Prerequisite & Domain Constraints |
|---|---|---|---|
| `PENDING` | `EN_ROUTE` | `DRIVER` (assigned only) | Driver departs to destination stop. |
| `EN_ROUTE` | `ARRIVED` | `DRIVER` / Geofence | Driver arrives at stop location (`arrivedAt = NOW()`). |
| `ARRIVED` | `UNLOADING` | `DRIVER` (assigned only) | Driver begins unloading cargo / verifying items. |
| `UNLOADING` | `DELIVERED` | `DRIVER` (assigned only) | **Mandatory POD Submission:** Requires `receiverName` and valid POD photo/signature file. Sets `completedAt = NOW()`. |
| `ARRIVED` / `UNLOADING` | `FAILED` | `DRIVER` (assigned only) | Mandatory failure reason / note provided. |
| `PENDING` | `SKIPPED` | `DRIVER`, `OWNER`, `ADMIN` | Operational skip with mandatory audit note. |

---

## 3. Proof of Delivery (POD) & Private Storage Architecture

### 3.1 Private Storage Adapter Pattern
- **Adapter:** `LocalPrivateStorageAdapter` implements `FileStorageAdapter`.
- **Directory:** `backend/storage/private/pod/{year}/{month}/{uuid}.jpg` (Out of public web root).
- **Validation:**
  - Magic Bytes Verification: JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), WebP (`52 49 46 46`).
  - File Size Cap: Photo $\le 5\text{ MB}$, Signature $\le 500\text{ KB}$.
  - SHA-256 Checksum generation.
- **Zero Public URL:** Downloads use authenticated route `GET /v1/files/:id/download` with `JwtAuthGuard` + Object-Level Ownership check.

### 3.2 POD Submission Flow
- Route: `POST /v1/me/stops/:id/pod`
- Body: `{ receiverName, photoFileId, signatureFileId?, notes?, idempotencyKey? }`
- Behavior:
  1. Validates stop status == `UNLOADING` or `ARRIVED`.
  2. Creates `ProofOfDelivery` DB record.
  3. Updates stop status to `DELIVERED` (`completedAt = NOW()`).
  4. Triggers automatic delivery completion evaluator.

---

## 4. Deterministic Offline Conflict Engine

- **Authority Matrix:** Database state di server adalah authoritative.
- **Evidence Preservation:** Jika Driver menyelesaikan stop offline (`DELIVERED` + POD photo) namun delivery di server berstatus `CANCELLED`, foto POD **TIDAK DIHAPUS**.
- Server membuat tiket konflik `DeliveryConflict`:
  - `status`: `OPEN`
  - `conflictType`: `STALE_OFFLINE_COMPLETION`
  - `clientPayload`: Event offline driver & reference file POD.
- Endpoint resolusi: `POST /v1/conflicts/:id/resolve` (`status: RESOLVED_OVERRIDDEN | RESOLVED_DISCARDED`).

---

## 5. Security & Anti-IDOR Invariants

- Driver A hanya bisa membaca/mengubah delivery & stop yang ditugaskan kepadanya (`delivery.driverId === req.user.driverId`).
- Driver A tidak bisa mengunduh file POD milik Driver B.
- Owner hanya dapat mengelola delivery dalam scope operasional perusahaannya.
- Idempotensi mutasi status & POD diproteksi via `idempotency_records`.
