# Phase 4: Telemetry, GPS Streaming & Fleet Monitoring — Design Specification

**Document Version:** 2.0.0 (Corrective Reconciled Baseline)
**Target Milestone:** Phase 4 Implementation Ready
**Date:** 2026-09-02
**Author:** AI Engineering Agent (BE & Security Lead)

---

## 1. Executive Summary & Goals

Phase 4 membangun fondasi backend terpadu untuk menerima, memvalidasi, menyimpan, dan mendistribusikan telemetri GPS Driver secara aman. Arsitektur ini dirancang untuk:

1. **Unified Telemetry Ingestion (`TELEMETRY-001`, `TELEMETRY-002`):** Menerima koordinat GPS dari smartphone Driver melalui REST API (`POST /v1/me/location`, `POST /v1/me/location/batch`) dan WebSocket (`driver.location.update`) menggunakan **satu layanan bisnis terpusat (`TrackingService`)** untuk menjamin konsistensi validasi dan keamanan.
2. **Cache & Realtime Broadcast (`TELEMETRY-003`):** Menyimpan posisi terkini di Redis (`driver:location:latest:<driverId>`) dan menyiarkan koordinat tervalidasi ke room realtime `fleet:monitoring` dan `delivery:<deliveryId>`.
3. **Fleet Visibility & Location History (`TELEMETRY-004`):** Menyediakan endpoint `GET /v1/fleet/locations` (Owner/Admin) dan `GET /v1/drivers/:id/location-history` (Driver own history, Owner scope, Admin full) dengan perlindungan anti-IDOR dan otorisasi terpadu.

---

## 2. Unified Ingestion Architecture (REST & WebSocket)

Guna mencegah perbedaan perilaku (*behavior divergence*) antara HTTP dan WebSocket:

```text
REST Controller (POST /v1/me/location) ─────┐
                                            ▼
WebSocket Gateway (driver.location.update) ──► TrackingService.processTelemetry()
                                                   │
                                                   ▼
                                        LocationValidationService
                                                   │
                                                   ▼
                                           Persistence Layer
                                         (Prisma Raw PostGIS)
                                                   │
                                            ┌──────┴──────┐
                                            ▼             ▼
                                       Redis Cache    Realtime Gateway Broadcast
```

- **Single Business Service:** `TrackingService.processTelemetry(dto, driverId, userRole, deviceId, sessionId)` adalah *single point of entry* yang dipanggil oleh REST Controller dan WebSocket Gateway.
- **Single Rate Limiting & Validation:** Kedua transport melewati pipeline validasi dan rate limiting Redis yang identik.

---

## 3. Unified Authorization & Privacy Rules

### 3.1 Authorization Matrix

| Endpoint / Operation | SUPER_ADMIN | ADMIN | OWNER | DRIVER |
|---|:---:|:---:|:---:|:---:|
| `POST /v1/me/location` (Single GPS Ingest) | ❌ | ❌ | ❌ | ✅ (own device/driverId) |
| `POST /v1/me/location/batch` (Batch Ingest) | ❌ | ❌ | ❌ | ✅ (own device/driverId) |
| WS `driver.location.update` | ❌ | ❌ | ❌ | ✅ (own socket) |
| `GET /v1/fleet/locations` (Fleet Live Map) | ✅ | ✅ | ✅ | ❌ (`403 FLEET_ACCESS_DENIED`) |
| `GET /v1/drivers/:id/location-history` | ✅ | ✅ | ✅ (company scope) | ✅ (ONLY IF `:id === req.user.driverId`) |
| WS Subscribe `fleet:monitoring` | ✅ | ✅ | ✅ | ❌ (`ROOM_ACCESS_DENIED`) |
| WS Subscribe `delivery:<id>` | ✅ | ✅ | ✅ | ✅ (ONLY IF `delivery.driverId === socket.driverId`) |

### 3.2 Unified Location History Authorization Rule
- **DRIVER:** Hanya diizinkan mengakses histori lokasinya sendiri (`:id === req.user.driverId`). Jika Driver A mencoba kueri `:id_driver_b`, backend mengembalikan `403 FORBIDDEN (RESOURCE_FORBIDDEN)`.
- **OWNER:** Diizinkan mengakses histori driver dalam scope operasional perusahaannya.
- **ADMIN / SUPER_ADMIN:** Akses penuh ke seluruh driver.

### 3.3 Delivery Ownership Validation Rule
Jika payload telemetri menyertakan `deliveryId`:
- Backend memverifikasi `delivery.driverId === req.user.driverId`.
- Jika `delivery.driverId !== req.user.driverId`, request ditolak `403 FORBIDDEN (DELIVERY_NOT_ASSIGNED_TO_DRIVER)`.
- Jika `deliveryId` tidak dikirim (null), lokasi disimpan dengan `delivery_id = null`.

---

## 4. GPS Validation Pipeline & Anomaly Detection

```text
[Client GPS Payload]
         │
         ▼
[1. Schema Validation (DTO)]
   - Required: latitude, longitude, accuracyM, recordedAt
   - Optional: speedMps, headingDeg, deliveryId, idempotencyKey
         │
         ▼
[2. Delivery Ownership Check (if deliveryId present)]
   - Assert delivery.driverId === req.user.driverId
   → Reject: 403 FORBIDDEN (DELIVERY_NOT_ASSIGNED_TO_DRIVER)
         │
         ▼
[3. Coordinate Bounds Check]
   - latitude: -90.0 ≤ lat ≤ 90.0
   - longitude: -180.0 ≤ lng ≤ 180.0
   → Reject: 400 BAD_REQUEST (INVALID_COORDINATES)
         │
         ▼
[4. Accuracy Threshold Filter]
   - accuracyM ≤ 50.0 meters
   → Reject: 422 (GPS_ACCURACY_BELOW_THRESHOLD)
         │
         ▼
[5. Clock Skew Validation]
   received_at = NOW()
   - Future: recorded_at > received_at + 5 minutes → Reject (TIMESTAMP_FUTURE)
   - Stale: recorded_at < received_at - 1 hour     → Reject (TIMESTAMP_STALE)
         │
         ▼
[6. Velocity Anomaly Detection]
   Fetch previous accepted point from Redis cache
   If previous point exists:
   - Calculate distance (Haversine / ST_Distance geography)
   - Calculate elapsed_time = recorded_at - prev.recorded_at
   - implied_speed_mps = distance / elapsed_time
   - If implied_speed_mps > 41.67 m/s (150 km/h) → Mark validation_status = 'ANOMALY_VELOCITY'
     Store to DB but skip realtime broadcast
         │
         ▼
[7. Race-Safe Idempotency Check]
   Check DB `idempotency_records` with unique constraint @@unique([key, userId, endpoint])
   If duplicate key exists: Return cached response (200 OK)
   If unique violation on concurrent insert (P2002): Catch and return existing record
         │
         ▼
[8. PostGIS DB Persistence]
   Store to location_points via Prisma raw SQL:
   - validation_status = 'VALID' | 'ANOMALY_VELOCITY'
   - received_at = NOW()
   - Trigger sync_point_geom() fires automatically
         │
         ▼
[9. Redis Cache Update (Out-of-Order Guard)]
   GET driver:location:latest:<driverId>
   IF new.recorded_at > cached.recorded_at OR cache miss:
     SET driver:location:latest:<driverId> = new_payload (TTL 86400s)
         │
         ▼
[10. Realtime Broadcast (VALID points only)]
   Emit canonical event 'driver.location.updated' to:
   - room 'fleet:monitoring'
   - room 'delivery:<deliveryId>' (if driver has active delivery)
```

---

## 5. Idempotency & Concurrency Safety

### 5.1 Database-Enforced Race Safety
Tabel `idempotency_records` pada PostgreSQL (Phase 1) memiliki unique constraint:
`@@unique([key, userId, endpoint])`

- **Skenario Request Konkuren:**
  Jika 2 request identik dengan `idempotencyKey` yang sama datang bersamaan:
  1. Request A berhasil melakukan `INSERT INTO idempotency_records`.
  2. Request B mengalami `P2002` (Prisma unique constraint violation).
  3. Handler Request B menangkap error `P2002`, melakukan query ulang `idempotency_records` untuk key tersebut, dan mengembalikan `responseBody` yang sudah disimpan oleh Request A dengan HTTP Status `200 OK`.
- **Hasil:** Race-safe 100%, tepat 1 mutasi/ingesti logis yang dieksekusi di database.

### 5.2 Batch Ingestion Idempotency Semantics
- **Batch-Level Idempotency (`idempotencyKey`):**
  Header/body `idempotencyKey` pada `POST /v1/me/location/batch` membungkus seluruh batch request. Jika batch request di-retry dengan `idempotencyKey` yang sama, server mengembalikan cached response `{ accepted, rejected, errors }` tanpa memproses ulang item batch.
- **Per-Point Deduplication:**
  Jika dalam satu batch atau antar batch terdapat koordinat dengan `(driver_id, recorded_at)` yang identik, query database melewatinya secara halus (*graceful duplicate skip*).

---

## 6. Rate Limiting & Offline Sync Compatibility

| Endpoint / Transport | Rate Limit Policy | Key | On Exceed (429) |
|---|---|---|---|
| `POST /v1/me/location` | 1 request / second / driver | `throttle:location:driver:<driverId>` | 429 Too Many Requests (`Retry-After: 1`) |
| WS `driver.location.update` | 1 event / second / driver | `throttle:location:driver:<driverId>` | Emit `rate_limit_exceeded`, payload dropped |
| `POST /v1/me/location/batch` | 1 batch / 60 seconds / driver | `throttle:location:batch:driver:<driverId>` | 429 Too Many Requests (`Retry-After: 60`) |

- **Offline Sync Behavior:**
  Aplikasi mobile yang baru online kembali mengirimkan buffer GPS dalam batch (maksimal 50 koordinat). Jika mobile client mengirim batch kedua dalam kurun waktu <60 detik, server merespons `429 Too Many Requests` dengan header `Retry-After: 60`. Client mobile mempertahankan outbox queue dan mencoba kembali setelah durasi `Retry-After` habis.

---

## 7. Realtime Event Specification

### 7.1 Event: `driver.location.updated`

```json
{
  "eventId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "event": "driver.location.updated",
  "version": 1,
  "timestamp": "2026-09-02T10:20:00.045Z",
  "correlationId": "c8f5f0b4-3a7e-46d2-850f-2b1b51e0cf9b",
  "actor": {
    "userId": "b8a34f89-8d7e-4a61-9c60-84a92c304d91",
    "role": "DRIVER",
    "deviceId": "550e8400-e29b-41d4-a716-446655440000",
    "driverId": "drv-b8a3-4f89"
  },
  "payload": {
    "driverId": "drv-b8a3-4f89",
    "deliveryId": "del-c8f5-f0b4",
    "latitude": -6.20012,
    "longitude": 106.81620,
    "accuracyM": 8.4,
    "speedMps": 11.7,
    "headingDeg": 87.0,
    "recordedAt": "2026-09-02T10:20:00.000Z",
    "receivedAt": "2026-09-02T10:20:00.045Z"
  }
}
```

---

## 8. Privacy & Log Sanitization Rules

1. Koordinat GPS mentah (`latitude`, `longitude`) **dilarang dicetak** ke application log umum atau error log.
2. Log yang diizinkan hanya mencatat metadata ringkas: `driverId`, `validationStatus`, `receivedAt`, `requestId`.
3. Audit log mencatat event `GPS_ANOMALY_DETECTED` saat kecepatan implausibel terdeteksi tanpa membocorkan koordinat di string pesan.
4. Histori lokasi dilindungi anti-IDOR: Driver A tidak dapat melihat histori lokasi Driver B.
