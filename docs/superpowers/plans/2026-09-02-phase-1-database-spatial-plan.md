# Phase 1: Database Architecture & PostGIS Spatial Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun skema database PostgreSQL 16 + PostGIS 3.4 menggunakan Prisma ORM v5.22.0, kolom spasial kanonikal `geometry(Point, 4326)` dengan trigger sinkronisasi otomatis universal, indeks spasial GiST fungsional `GIST (((geom)::geography))`, partial unique index alokasi kendaraan, partisi tabel `location_points` bulanan dengan default partition fallback, tabel normalized E2EE `prekeys`, serta `PrismaService` di backend NestJS.

**Architecture:** Prisma ORM v5.22.0 dengan custom raw SQL spatial extensions (`Unsupported("geometry(Point, 4326)")`), versioned SQL migrations (`prisma/migrations`), dedicated `PrismaService` lifecycle manager, dan PostgreSQL triggers/partitioning.

**Tech Stack:** PostgreSQL 16, PostGIS 3.4, Prisma 5.22.0, `@prisma/client` 5.22.0, Docker Compose.

---

## Global Constraints

- **Runtime Baseline:** `Node.js 22 LTS (Active LTS)`
- **Prisma Version Pinned:** `@prisma/client: 5.22.0`, `prisma: 5.22.0`
- **Migration Policy:** `prisma migrate deploy` sebagai satu-satunya pipeline eksekusi migrasi (zero `db push` in verification).
- **Database Engine:** PostgreSQL 16 + PostGIS 3.4
- **Spatial SRID:** 4326 (WGS 84 Point Coordinates: `Point(longitude, latitude)`)
- **Spatial Indexing:** Functional GiST Expression Index `GIST (((geom)::geography))`
- **Timestamp Standard:** `TIMESTAMPTZ(3)` / UTC (`@db.Timestamptz(3)`)
- **Zero Plaintext Secrets:** Docker Compose dan aplikasi backend hanya membaca credentials via env substitution.

---

## File Structure Map

```text
backend/
├── prisma/
│   ├── migrations/
│   │   ├── 20260902000001_init_postgis_relational/
│   │   │   └── migration.sql
│   │   └── 20260902000002_spatial_logistics_and_partitions/
│   │       └── migration.sql
│   └── schema.prisma
├── src/
│   ├── common/
│   │   └── prisma/
│   │       ├── prisma.service.ts
│   │       └── prisma.module.ts
│   └── app.module.ts
├── test/
│   └── database/
│       ├── relational-integrity.e2e-spec.ts
│       ├── spatial-triggers-indexes.e2e-spec.ts
│       ├── assignment-overlap.e2e-spec.ts
│       ├── prekey-concurrency.e2e-spec.ts
│       └── partition-lifecycle.e2e-spec.ts
├── package.json
└── tsconfig.json
```

---

## Task Breakdown & Bite-Sized Steps

---

### Task 1.1: Prisma 5.22.0 Integration & Master Relational Schema (`DB-GEO-001`)

**Files:**
- Modify: `backend/package.json` (pin `@prisma/client: 5.22.0`, `prisma: 5.22.0`)
- Create: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260902000001_init_postgis_relational/migration.sql`
- Create: `backend/src/common/prisma/prisma.service.ts`
- Create: `backend/src/common/prisma/prisma.module.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/test/database/relational-integrity.e2e-spec.ts`

**Interfaces:**
- Produces: `PrismaService` with `$connect`, `$disconnect`, and master entity models.

- [ ] **Step 1: Install & Pin Prisma 5.22.0**

Run: `cd backend && npm install @prisma/client@5.22.0 && npm install -D prisma@5.22.0`

- [ ] **Step 2: Definisikan Master Relational Schema di `backend/prisma/schema.prisma`**

Definisikan model: `Role`, `Permission`, `RolePermission`, `User`, `Driver`, `Vehicle`, `VehicleAssignment`, `Device`, `Session`, `DeviceKey`, `Prekey`.

- [ ] **Step 3: Susun Migration 1 SQL (`20260902000001_init_postgis_relational/migration.sql`)**

Tulis SQL DDL:
1. `CREATE EXTENSION IF NOT EXISTS postgis;`
2. Tabel-tabel master (`roles`, `permissions`, `role_permissions`, `users`, `drivers`, `vehicles`, `vehicle_assignments`, `devices`, `sessions`, `device_keys`, `prekeys`).
3. Partial unique index alokasi kendaraan:
   ```sql
   CREATE UNIQUE INDEX idx_unique_active_vehicle_assignment
     ON vehicle_assignments (vehicle_id) WHERE status = 'ACTIVE';
   CREATE UNIQUE INDEX idx_unique_active_driver_assignment
     ON vehicle_assignments (driver_id) WHERE status = 'ACTIVE';
   ```

- [ ] **Step 4: Implementasikan PrismaService & PrismaModule**

Buat `backend/src/common/prisma/prisma.service.ts` dan `backend/src/common/prisma/prisma.module.ts`. Import `PrismaModule` di `backend/src/app.module.ts`.

- [ ] **Step 5: Generate Prisma Client & Test Relational Integrity**

Run: `cd backend && npx prisma generate && npm run build`  
Expected: PASS.

---

### Task 1.2: Spatial Schema, Operational Logistics & Location Partitioning (`DB-GEO-002`)

**Files:**
- Modify: `backend/prisma/schema.prisma` (add Delivery, Items, Stops, Routes, Outbox Events, Files, POD, Conflicts, Audit, SOS, Messaging, Realtime, Notifications)
- Create: `backend/prisma/migrations/20260902000002_spatial_logistics_and_partitions/migration.sql`

- [ ] **Step 1: Lengkapi seluruh model operasional di `backend/prisma/schema.prisma`**

Tambahkan model:
- `Delivery` (`id`, `deliveryCode`, `driverId`, `vehicleId`, `status`, `routeMode`, `plannedStartAt`, `startedAt`, `completedAt`, `createdBy`, timestamps)
- `DeliveryItem` (`id`, `deliveryId`, `itemCode`, `itemName`, `quantity`, `unit`, `weightKg`, `volumeM3`)
- `DeliveryStop` (`id`, `deliveryId`, `sequence`, `destinationName`, `address`, `latitude`, `longitude`, `geom`, `geofenceRadiusM`, `status`, timestamps)
- `Route` (`id`, `deliveryId`, `version`, `source`, `totalDistanceM`, `estimatedDurationS`, `polylineGeojson`, `selectedAt`)
- `RouteStop` (`id`, `routeId`, `deliveryStopId`, `sequence`)
- `DeliveryEvent` (`id`, `deliveryId`, `stopId`, `eventType`, `actorUserId`, `metadataJson`, `clientOccurredAt`, `occurredAt`, `receivedAt`, `idempotencyKey`)
- `ProofOfDelivery` (`id`, `deliveryStopId`, `receiverName`, `signatureFileId`, `photoFileId`, `notes`, `completedAt`, `createdBy`, `createdAt`)
- `FileRecord` (`id`, `objectKey`, `mediaType`, `sizeBytes`, `checksumSha256`, `uploadedBy`, `createdAt`)
- `DeliveryConflict` (`id`, `deliveryId`, `clientEventId`, `conflictType`, `serverState`, `clientPayload`, `status`, `resolvedBy`, `resolutionNotes`, timestamps)
- `AuditLog` (`id`, `actorUserId`, `action`, `entityType`, `entityId`, `beforeJson`, `afterJson`, `result`, `requestId`, `ipAddress`, `userAgent`, `createdAt`)
- `IdempotencyRecord` (`id`, `key`, `userId`, `endpoint`, `responseStatus`, `responseBody`, `createdAt`, `expiresAt`)
- `Emergency` (`id`, `driverId`, `deliveryId`, `latitude`, `longitude`, `geom`, `emergencyType`, `note`, `status`, `triggeredAt`, `resolvedAt`, `resolvedBy`)
- `Conversation` (`id`, `type`, `ownerId`, `driverId`, `status`, `createdAt`)
- `Message` (`id`, `conversationId`, `senderUserId`, `senderDeviceId`, `recipientDeviceId`, `protocolVersion`, `ciphertextBlob`, `headerJson`, timestamps)
- `RealtimeSession` (`id`, `type`, `ownerId`, `driverId`, `deliveryId`, `status`, timestamps)
- `Notification` (`id`, `userId`, `deviceId`, `type`, `title`, `body`, `payloadJson`, `provider`, `providerMessageId`, `status`, `createdAt`)

- [ ] **Step 2: Susun Migration 2 SQL (`20260902000002_spatial_logistics_and_partitions/migration.sql`)**

Tulis SQL DDL:
1. Pembuatan tabel operasional dan foreign keys.
2. Range-partitioned table `location_points` (`PRIMARY KEY (id, recorded_at)`).
3. `location_points_default` partition.
4. Initial monthly partitions (2026_09 s/d 2026_12).
5. Composite unique constraints (`@@unique([deliveryId, sequence])`, etc.).

---

### Task 1.3: GiST Spatial Expression Indexing & Universal Coordinate Sync Triggers (`DB-GEO-003`)

**Files:**
- Modify: `backend/prisma/migrations/20260902000002_spatial_logistics_and_partitions/migration.sql` (append triggers, GiST expression indexes, and checks)
- Create: `backend/test/database/spatial-triggers-indexes.e2e-spec.ts`
- Create: `backend/test/database/assignment-overlap.e2e-spec.ts`
- Create: `backend/test/database/prekey-concurrency.e2e-spec.ts`
- Create: `backend/test/database/partition-lifecycle.e2e-spec.ts`

- [ ] **Step 1: Tambahkan Universal Triggers, GiST Expression Indexes & Checks ke Migration 2**

```sql
-- 1. Universal Sync Trigger Function
CREATE OR REPLACE FUNCTION sync_point_geom()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.longitude IS NOT NULL AND NEW.latitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  ELSIF NEW.geom IS NOT NULL THEN
    NEW.longitude := ST_X(NEW.geom);
    NEW.latitude := ST_Y(NEW.geom);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_delivery_stops_geom
  BEFORE INSERT OR UPDATE ON delivery_stops
  FOR EACH ROW EXECUTE FUNCTION sync_point_geom();

CREATE TRIGGER trg_sync_location_points_geom
  BEFORE INSERT OR UPDATE ON location_points
  FOR EACH ROW EXECUTE FUNCTION sync_point_geom();

CREATE TRIGGER trg_sync_emergencies_geom
  BEFORE INSERT OR UPDATE ON emergencies
  FOR EACH ROW EXECUTE FUNCTION sync_point_geom();

-- 2. Functional GiST Expression Indexes for Metric Distance / Geofence Queries
CREATE INDEX idx_delivery_stops_geog ON delivery_stops USING GIST (((geom)::geography));
CREATE INDEX idx_location_points_geog ON location_points USING GIST (((geom)::geography));
CREATE INDEX idx_emergencies_geog ON emergencies USING GIST (((geom)::geography));

-- 3. Composite Operational Indexes
CREATE INDEX idx_location_points_driver_recorded ON location_points (driver_id, recorded_at DESC);
CREATE INDEX idx_deliveries_driver_status ON deliveries (driver_id, status);

-- 4. Check Constraints
ALTER TABLE delivery_stops
  ADD CONSTRAINT check_delivery_stops_lat_range CHECK (latitude >= -90 AND latitude <= 90),
  ADD CONSTRAINT check_delivery_stops_lng_range CHECK (longitude >= -180 AND longitude <= 180);

ALTER TABLE location_points
  ADD CONSTRAINT check_location_points_lat_range CHECK (latitude >= -90 AND latitude <= 90),
  ADD CONSTRAINT check_location_points_lng_range CHECK (longitude >= -180 AND longitude <= 180);

ALTER TABLE delivery_events
  ADD CONSTRAINT check_delivery_events_metadata_size CHECK (octet_length(metadata_json::text) <= 65536);
```

- [ ] **Step 2: Tulis Comprehensive E2E Database Test Suites**

Tulis test files:
- `relational-integrity.e2e-spec.ts`: Memvalidasi foreign key behavior dan `ON DELETE RESTRICT`.
- `spatial-triggers-indexes.e2e-spec.ts`: Memvalidasi bahwa trigger otomatis mengisi `geom` dan kueri `ST_DWithin(geom::geography, ...)` menggunakan index `idx_delivery_stops_geog`.
- `assignment-overlap.e2e-spec.ts`: Memvalidasi bahwa duplikasi active assignment ditolak PostgreSQL Error 23505.
- `prekey-concurrency.e2e-spec.ts`: Memvalidasi kueri atomik `FOR UPDATE SKIP LOCKED` pada 5 transaksi konkuren.
- `partition-lifecycle.e2e-spec.ts`: Memvalidasi insert partisi bulanan dan fallback ke `location_points_default`.

- [ ] **Step 3: Eksekusi Migration Deploy & Jalankan Test Suite**

Commands:
```bash
# 1. Start Docker PostGIS & Redis
cd backend && docker compose up -d

# 2. Deploy Migrations
cd backend && npx prisma migrate deploy

# 3. Run E2E Test Suite
cd backend && npm run test:e2e

# 4. Verify Build
cd backend && npm run build
```
Expected: All test suites PASS (100% green).

---

## Verification Plan

### Automated Tests
- `cd backend && npx prisma migrate deploy`
- `cd backend && npm run test:e2e`
- `cd backend && npm run test`
- `cd backend && npm run build`

### Manual Verification
1. `npx prisma migrate status` $\rightarrow$ verify 2 migrations applied cleanly.
2. `EXPLAIN ANALYZE SELECT * FROM delivery_stops WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(106.8, -6.2), 4326)::geography, 500);` $\rightarrow$ verify `Bitmap Index Scan on idx_delivery_stops_geog`.
3. `SELECT count(*) FROM location_points_default;` $\rightarrow$ verify observability query.
