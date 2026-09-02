# Phase 1: Database Architecture & PostGIS Spatial Core — Design Spec

**Document Version:** 1.2.0 (Final Reconciled & Audited Baseline)  
**Target Milestone:** Phase 1 Implementation Ready  
**Date:** 2026-09-02  
**Author:** AI Engineering Agent (BE & Security Lead)

---

## 1. Executive Summary & Goals

Phase 1 membangun fondasi data persisten sistem menggunakan **PostgreSQL 16 + PostGIS 3.4** dan **Prisma ORM v5.22.0** (berdasarkan keputusan `ADR-001` dan `ADR-006`). Dokumen versi 1.2.0 ini menyempurnakan keselarasan antara kueri spasial dan indeks GiST fungsional, penegakan sinkronisasi koordinat universal, audit kelengkapan foreign key, pemisahan semantik idempotency dua tingkat, serta pemantauan partisi fallback.

### Core Objectives of Phase 1:
1. **Relational Core & PostGIS Extension (`DB-GEO-001`):** Inisialisasi ekstensi PostGIS, pembuatan tabel entitas master dengan foreign key protection (`ON DELETE RESTRICT` untuk data transaksi) dan enum types.
2. **Spatial Schema, Delivery State & Location Partitioning (`DB-GEO-002`):** Pembuatan tabel operasional logistik, tabel event outbox, normalized `prekeys`, dan skema partisi waktu bulanan pada `location_points` yang dilengkapi `location_points_default`.
3. **GiST Spatial Expression Indexing & Integrity Constraints (`DB-GEO-003`):** Implementasi indeks GiST ekspresi fungsional `GIST (((geom)::geography))`, trigger sinkronisasi koordinat universal, partial unique index untuk alokasi kendaraan, check constraints WGS84, dan automated verification tests.

---

## 2. Technical Decisions & Pinned Specifications

1. **ORM Version Pinned:** **`Prisma v5.22.0`** dan **`@prisma/client v5.22.0`** (versi stabil teruji dengan Node.js 22 LTS).
2. **Migration Workflow:** Menggunakan **Prisma Migrate (`prisma migrate dev` di lokal, `prisma migrate deploy` di CI/CD dan staging)** sebagai *single source of truth*. Perintah `prisma db push` dilarang keras pada verification dan production path.
3. **Migration Boundaries & Ownership:**
   - **Migration 1 (`Task 1.1` / `20260902000001_init_postgis_relational`):** PostGIS extension + Master relational tables (`roles`, `permissions`, `role_permissions`, `users`, `drivers`, `vehicles`, `vehicle_assignments`, `devices`, `sessions`, `device_keys`, `prekeys`) + Partial unique indexes.
   - **Migration 2 (`Task 1.2 & 1.3` / `20260902000002_spatial_logistics_and_partitions`):** Operational logistics + Partitioned `location_points` + `location_points_default` + Universal sync triggers + GiST expression indexes + Check constraints.
4. **Timestamp Standardization (TIMESTAMPTZ / UTC):** Seluruh kolom waktu operasional menggunakan tipe **`TIMESTAMPTZ(3)` / `TIMESTAMP(3) WITH TIME ZONE`** (`@db.Timestamptz(3)`) dan diisi dengan ISO 8601 UTC timestamp.
5. **Coordinate Canonical Representation & Sync Policy:**
   - **Source of Truth:** Kolom PostGIS `geom geometry(Point, 4326)` (Non-nullable pada record koordinat).
   - **Scalar Projection:** Kolom `latitude` dan `longitude` (`DECIMAL(10, 7) NOT NULL`) untuk serialisasi cepat ke client.
   - **Universal Sync Trigger:** Trigger `sync_point_geom_trigger` otomatis menyinkronkan `geom` dari `(latitude, longitude)` pada tabel `delivery_stops`, `location_points`, dan `emergencies`.
6. **Spatial Index Alignment (Functional GiST Expression):**
   - Kueri jarak dan geofence menggunakan meter geodesik: `ST_DWithin(geom::geography, target_geog, radius_m)`.
   - Indeks dibuat sebagai **functional expression index**:
     ```sql
     CREATE INDEX idx_delivery_stops_geog ON delivery_stops USING GIST (((geom)::geography));
     CREATE INDEX idx_location_points_geog ON location_points USING GIST (((geom)::geography));
     CREATE INDEX idx_emergencies_geog ON emergencies USING GIST (((geom)::geography));
     ```
     Menjamin query planner PostgreSQL mengeksekusi *Bitmap Index Scan* langsung pada index GiST.
7. **Two-Tier Idempotency Semantics:**
   - **Tier 1 (HTTP Gateway Idempotency):** `idempotency_records` (`@@unique([key, userId, endpoint])`) menyimpan status code dan response JSON selama 24 jam untuk menangani network retry HTTP.
   - **Tier 2 (Domain Event Outbox Idempotency):** `delivery_events.idempotency_key` (`UUID unique nullable`) menjamin satu aksi lapangan hanya dicatat 1 kali dalam log event sourcing meskipun di-flush via offline batch sync.
8. **Partition Observability Rule:**
   - `location_points_default` dipantau via query health check (`SELECT count(*) FROM location_points_default;`). Jika row count > 0, sistem mengeluarkan alert warning.

---

## 3. Database Schema & Integrity Constraints

### 3.1 Master Entities & Authentication
- `roles`: `id` (UUID), `code` (VARCHAR 50 unique), `name` (VARCHAR 100).
- `permissions`: `id` (UUID), `code` (VARCHAR 100 unique), `description` (TEXT nullable).
- `role_permissions`: `(role_id, permission_id)` (Composite PK).
- `users`: `id` (UUID), `username` (VARCHAR 50 unique), `email` (VARCHAR 100 unique nullable), `phone` (VARCHAR 20 unique), `password_hash` (VARCHAR 255), `role_id` (FK `roles(id)` `ON DELETE RESTRICT`), `status` (ENUM: `PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED`, `DISABLED`), `created_by` (FK `users(id)` `ON DELETE SET NULL`), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ), `last_login_at` (TIMESTAMPTZ nullable).
- `drivers`: `id` (UUID), `user_id` (FK `users(id)` `ON DELETE RESTRICT` unique), `employee_code` (VARCHAR 50 unique), `display_name` (VARCHAR 100), `phone` (VARCHAR 20), `active_vehicle_id` (UUID nullable), `operational_status` (ENUM: `OFFLINE`, `AVAILABLE`, `ON_DELIVERY`, `EMERGENCY`).
- `vehicles`: `id` (UUID), `plate_number` (VARCHAR 20 unique), `vehicle_type` (ENUM: `MOTORCYCLE`, `VAN`, `TRUCK_SMALL`, `TRUCK_LARGE`), `capacity_weight_kg` (DECIMAL 10,2), `capacity_volume_m3` (DECIMAL 10,2 nullable), `status` (ENUM: `ACTIVE`, `MAINTENANCE`, `INACTIVE`), `notes` (TEXT nullable).
- `vehicle_assignments`: `id` (UUID), `driver_id` (FK `drivers(id)` `ON DELETE RESTRICT`), `vehicle_id` (FK `vehicles(id)` `ON DELETE RESTRICT`), `started_at` (TIMESTAMPTZ), `ended_at` (TIMESTAMPTZ nullable), `status` (ENUM: `ACTIVE`, `COMPLETED`, `REVOKED`).
  - **Constraints:** Partial unique index: Hanya 1 assignment berstatus `ACTIVE` per `vehicle_id` dan per `driver_id`.
- `devices`: `id` (UUID), `user_id` (FK `users(id)` `ON DELETE CASCADE`), `device_identifier` (VARCHAR 100), `platform` (ENUM: `ANDROID`, `IOS`, `WEB`), `app_version` (VARCHAR 50), `push_token` (TEXT nullable), `status` (ENUM: `ACTIVE`, `REVOKED`), `created_at` (TIMESTAMPTZ), `last_seen_at` (TIMESTAMPTZ).
- `sessions`: `id` (UUID), `user_id` (FK `users(id)` `ON DELETE CASCADE`), `device_id` (FK `devices(id)` `ON DELETE CASCADE`), `refresh_token_hash` (VARCHAR 255), `token_family` (UUID), `is_revoked` (BOOLEAN default false), `expires_at` (TIMESTAMPTZ), `created_at` (TIMESTAMPTZ), `last_refreshed_at` (TIMESTAMPTZ).
- `device_keys`: `id` (UUID), `device_id` (FK `devices(id)` `ON DELETE CASCADE` unique), `identity_key_public` (TEXT), `signed_prekey_public` (TEXT), `signed_prekey_sig` (TEXT), `updated_at` (TIMESTAMPTZ).
- `prekeys`: `id` (UUID), `device_id` (FK `devices(id)` `ON DELETE CASCADE`), `key_id` (INT), `public_key` (TEXT), `is_consumed` (BOOLEAN default false), `consumed_at` (TIMESTAMPTZ nullable), `created_at` (TIMESTAMPTZ).
  - **Constraints:** `@@unique([deviceId, keyId])`, `@@index([deviceId, isConsumed])`.

### 3.2 Delivery & Logistics Operations
- `deliveries`: `id` (UUID), `delivery_code` (VARCHAR 50 unique), `driver_id` (FK `drivers(id)` `ON DELETE RESTRICT` nullable), `vehicle_id` (FK `vehicles(id)` `ON DELETE RESTRICT` nullable), `status` (ENUM: `DRAFT`, `ASSIGNED`, `ACCEPTED`, `EN_ROUTE`, `COMPLETED`, `CANCELLED`, `FAILED`), `route_mode` (ENUM: `MANUAL`, `RECOMMENDED_2OPT`), `planned_start_at` (TIMESTAMPTZ nullable), `started_at` (TIMESTAMPTZ nullable), `completed_at` (TIMESTAMPTZ nullable), `created_by` (FK `users(id)` `ON DELETE RESTRICT`), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
- `delivery_items`: `id` (UUID), `delivery_id` (FK `deliveries(id)` `ON DELETE CASCADE`), `item_code` (VARCHAR 50), `item_name` (VARCHAR 100), `quantity` (INT), `unit` (VARCHAR 20), `weight_kg` (DECIMAL 10,2 nullable), `volume_m3` (DECIMAL 10,2 nullable).
- `delivery_stops`: `id` (UUID), `delivery_id` (FK `deliveries(id)` `ON DELETE CASCADE`), `sequence` (INT), `destination_name` (VARCHAR 100), `address` (TEXT), `latitude` (DECIMAL 10,7), `longitude` (DECIMAL 10,7), `geom` (`geometry(Point, 4326)` NOT NULL), `geofence_radius_m` (INT default 100), `status` (ENUM: `PENDING`, `EN_ROUTE`, `ARRIVED`, `UNLOADING`, `DELIVERED`, `FAILED`, `SKIPPED`), `arrived_at` (TIMESTAMPTZ nullable), `completed_at` (TIMESTAMPTZ nullable).
  - **Constraints:** `@@unique([deliveryId, sequence])`, check constraints WGS84 range, GiST expression index on `((geom)::geography)`.
- `routes`: `id` (UUID), `delivery_id` (FK `deliveries(id)` `ON DELETE CASCADE`), `version` (INT default 1), `source` (ENUM: `MANUAL`, `RECOMMENDED_2OPT`, `EXTERNAL_OSRM`), `total_distance_m` (DECIMAL 12,2), `estimated_duration_s` (INT), `polyline_geojson` (JSONB nullable), `selected_at` (TIMESTAMPTZ).
  - **Constraints:** `@@unique([deliveryId, version])`.
- `route_stops`: `id` (UUID), `route_id` (FK `routes(id)` `ON DELETE CASCADE`), `delivery_stop_id` (FK `delivery_stops(id)` `ON DELETE CASCADE`), `sequence` (INT).
  - **Constraints:** `@@unique([routeId, sequence])`, `@@unique([routeId, deliveryStopId])`.

### 3.3 Spatial Telemetry & Range Partitioning
- `location_points`: `id` (UUID), `driver_id` (FK `drivers(id)` `ON DELETE RESTRICT`), `delivery_id` (FK `deliveries(id)` `ON DELETE SET NULL` nullable), `latitude` (DECIMAL 10,7), `longitude` (DECIMAL 10,7), `geom` (`geometry(Point, 4326)` NOT NULL), `accuracy_m` (DECIMAL 6,2), `speed_mps` (DECIMAL 6,2 nullable), `heading_deg` (DECIMAL 5,2 nullable), `recorded_at` (TIMESTAMPTZ), `received_at` (TIMESTAMPTZ default NOW()), `source` (VARCHAR 50 default 'driver_app'), `validation_status` (VARCHAR 20 default 'VALID').
  - **Primary Key:** `(id, recorded_at)`.
  - **Partitioning:** `PARTITION BY RANGE (recorded_at)`.
  - **Safety Fallback:** `location_points_default` memastikan insert tidak gagal jika partisi bulan baru belum dibuat.
  - **Indeks:** GiST expression index `GIST (((geom)::geography))` dan composite index `(driver_id, recorded_at DESC)`.

### 3.4 Consistency, Evidence & Communication
- `delivery_events`: `id` (UUID), `delivery_id` (FK `deliveries(id)` `ON DELETE CASCADE`), `stop_id` (FK `delivery_stops(id)` `ON DELETE SET NULL` nullable), `event_type` (VARCHAR 50), `actor_user_id` (FK `users(id)` `ON DELETE RESTRICT`), `metadata_json` (JSONB, max 64 KB), `client_occurred_at` (TIMESTAMPTZ nullable), `occurred_at` (TIMESTAMPTZ), `received_at` (TIMESTAMPTZ), `idempotency_key` (UUID unique nullable).
- `proof_of_delivery`: `id` (UUID), `delivery_stop_id` (FK `delivery_stops(id)` `ON DELETE RESTRICT` unique), `receiver_name` (VARCHAR 100), `signature_file_id` (FK `files(id)` `ON DELETE SET NULL` nullable), `photo_file_id` (FK `files(id)` `ON DELETE SET NULL` nullable), `notes` (TEXT nullable), `completed_at` (TIMESTAMPTZ), `createdBy` (FK `users(id)` `ON DELETE RESTRICT`), `created_at` (TIMESTAMPTZ).
- `files`: `id` (UUID), `object_key` (VARCHAR 255 unique), `media_type` (VARCHAR 100), `size_bytes` (INT), `checksum_sha256` (VARCHAR 64), `uploaded_by` (FK `users(id)` `ON DELETE RESTRICT`), `created_at` (TIMESTAMPTZ).
- `delivery_conflicts`: `id` (UUID), `delivery_id` (FK `deliveries(id)` `ON DELETE RESTRICT`), `client_event_id` (VARCHAR 100), `conflict_type` (VARCHAR 50), `server_state` (VARCHAR 50), `client_payload` (JSONB, max 64 KB), `status` (ENUM: `OPEN`, `RESOLVED_OVERRIDDEN`, `RESOLVED_DISCARDED`), `resolved_by` (FK `users(id)` `ON DELETE SET NULL` nullable), `resolution_notes` (TEXT nullable), `created_at` (TIMESTAMPTZ), `resolved_at` (TIMESTAMPTZ nullable).
- `audit_logs`: `id` (UUID), `actor_user_id` (FK `users(id)` `ON DELETE SET NULL` nullable), `action` (VARCHAR 100), `entity_type` (VARCHAR 50), `entity_id` (VARCHAR 100), `before_json` (JSONB nullable, max 64 KB), `after_json` (JSONB nullable, max 64 KB), `result` (VARCHAR 20), `request_id` (VARCHAR 36 nullable), `ip_address` (VARCHAR 45 nullable), `user_agent` (TEXT nullable), `created_at` (TIMESTAMPTZ default NOW()).
- `idempotency_records`: `id` (UUID), `key` (UUID), `user_id` (FK `users(id)` `ON DELETE CASCADE`), `endpoint` (VARCHAR 100), `response_status` (INT), `response_body` (JSONB), `created_at` (TIMESTAMPTZ default NOW()), `expires_at` (TIMESTAMPTZ).
  - **Constraints:** `@@unique([key, userId, endpoint])`.
- `emergencies`: `id` (UUID), `driver_id` (FK `drivers(id)` `ON DELETE RESTRICT`), `delivery_id` (FK `deliveries(id)` `ON DELETE SET NULL` nullable), `latitude` (DECIMAL 10,7), `longitude` (DECIMAL 10,7), `geom` (`geometry(Point, 4326)` NOT NULL), `emergency_type` (VARCHAR 50), `note` (TEXT nullable), `status` (ENUM: `TRIGGERED`, `ACKNOWLEDGED`, `RESOLVED`, `FALSE_ALARM`), `triggered_at` (TIMESTAMPTZ), `resolved_at` (TIMESTAMPTZ nullable), `resolved_by` (FK `users(id)` `ON DELETE SET NULL` nullable).
- `conversations`: `id` (UUID), `type` (ENUM: `DIRECT_1TO1`), `owner_id` (FK `users(id)` `ON DELETE RESTRICT`), `driver_id` (FK `drivers(id)` `ON DELETE RESTRICT`), `status` (ENUM: `ACTIVE`, `ARCHIVED`), `created_at` (TIMESTAMPTZ).
- `messages`: `id` (UUID), `conversation_id` (FK `conversations(id)` `ON DELETE CASCADE`), `sender_user_id` (FK `users(id)` `ON DELETE RESTRICT`), `sender_device_id` (FK `devices(id)` `ON DELETE RESTRICT`), `recipient_device_id` (FK `devices(id)` `ON DELETE RESTRICT`), `protocol_version` (INT), `ciphertext_blob` (TEXT), `header_json` (JSONB, max 64 KB), `created_at` (TIMESTAMPTZ), `delivered_at` (TIMESTAMPTZ nullable), `read_at` (TIMESTAMPTZ nullable).
- `realtime_sessions`: `id` (UUID), `type` (ENUM: `VOICE_PTT`, `VIDEO`), `owner_id` (FK `users(id)` `ON DELETE RESTRICT`), `driver_id` (FK `drivers(id)` `ON DELETE RESTRICT`), `delivery_id` (FK `deliveries(id)` `ON DELETE SET NULL` nullable), `status` (ENUM: `PENDING`, `ACTIVE`, `DECLINED`, `TIMEOUT`, `ENDED`), `created_at` (TIMESTAMPTZ), `expires_at` (TIMESTAMPTZ), `started_at` (TIMESTAMPTZ nullable), `ended_at` (TIMESTAMPTZ nullable).
- `notifications`: `id` (UUID), `user_id` (FK `users(id)` `ON DELETE CASCADE`), `device_id` (FK `devices(id)` `ON DELETE SET NULL` nullable), `type` (VARCHAR 50), `title` (VARCHAR 255), `body` (TEXT), `payload_json` (JSONB, max 64 KB), `provider` (VARCHAR 50), `provider_message_id` (VARCHAR 100 nullable), `status` (ENUM: `QUEUED`, `SENT`, `FAILED`, `READ`), `created_at` (TIMESTAMPTZ).

---

## 4. Verification Plan for Phase 1

1. **Prisma Migrate Clean Database Test:**
   - Menjalankan `npx prisma migrate deploy` pada instance PostgreSQL clean dan membuktikan seluruh 20+ tabel, enum, dan relasi terbentuk sempurna.
2. **PostGIS Geometry & Universal Sync Trigger Test:**
   - Insert data `delivery_stops` dan `location_points` hanya dengan lat/lng $\rightarrow$ verifikasi kolom `geom` otomatis terisi dengan SRID 4326 yang cocok dan non-null.
3. **GiST Spatial Expression Index & Query Plan Verification:**
   - Kueri `EXPLAIN ANALYZE SELECT * FROM delivery_stops WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(106.8, -6.2), 4326)::geography, 500);` membuktikan penggunaan `Bitmap Index Scan on idx_delivery_stops_geog`.
4. **Active Vehicle Assignment Overlap Rejection Test:**
   - Percobaan membuat 2 record `vehicle_assignments` berstatus `ACTIVE` untuk kendaraan yang sama ditolak oleh Partial Unique Index (PostgreSQL Error 23505).
5. **Atomic Prekey Consumption Test:**
   - Eksekusi kueri `FOR UPDATE SKIP LOCKED` pada 5 request paralel mengonsumsi 5 prekey unik yang berbeda tanpa duplikasi.
6. **Location Points Partition & Fallback Test:**
   - Insert koordinat pada partisi bulan berjalan dan insert data koordinat di luar range partisi $\rightarrow$ masuk ke `location_points_default` tanpa error.
