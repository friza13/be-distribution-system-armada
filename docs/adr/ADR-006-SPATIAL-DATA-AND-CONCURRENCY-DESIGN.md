# ADR-006: Database Spatial Types, Expression Indexing, Concurrency & Idempotency Architecture

- **Status:** ACCEPTED (Phase 1 Baseline)
- **Deciders:** BE Lead, Security Lead, Data Architect
- **Date:** 2026-09-02
- **Technical Context:** PostgreSQL 16 + PostGIS 3.4, Prisma 5.22.0, NestJS 10, Node.js 22 LTS.

---

## 1. Context & Problem Statement

Phase 1 mendefinisikan arsitektur data persisten PostgreSQL + PostGIS. Pass konsistensi terakhir mengidentifikasi 7 aspek kritis:
1. **Spatial Index & Expression Query Alignment:** Kueri jarak dan geofence menggunakan `ST_DWithin(geom::geography, ...)` memerlukan **functional GiST expression index** pada `(geom::geography)` agar index scan dapat dieksekusi oleh query planner PostgreSQL.
2. **Universal Coordinate Synchronization:** Kolom scalar `(latitude, longitude)` dan PostGIS `geom geometry(Point, 4326)` harus disinkronkan secara atomik pada seluruh tabel koordinat (`delivery_stops`, `location_points`, `emergencies`).
3. **Geom Nullability:** Kolom spasial tidak boleh bernilai NULL pada record koordinat valid.
4. **Complete Foreign Key Referential Integrity:** Menghubungkan seluruh foreign keys relasional termasuk `location_points` ke `drivers`/`deliveries` dan `messages` ke `devices`.
5. **Two-Tier Idempotency Semantics:** Memisahkan peran HTTP layer idempotency (`idempotency_records`) dan Domain Event outbox idempotency (`delivery_events.idempotency_key`).
6. **Vehicle Assignment Overlap Protection:** Menggunakan Partial Unique Indexes pada PostgreSQL.
7. **Observability Fallback Partition:** Memantau row count pada `location_points_default` sebagai alert indikator kesehatan partisi.

---

## 2. Decisions & Architectural Rules

### 2.1 Spatial Storage & Functional Expression Indexing
- **Penyimpanan (At-Rest):** Menggunakan `geometry(Point, 4326)` (WGS 84).
- **Kueri Metrik / Jarak Geodesik:** Menggunakan casting `ST_DWithin(geom::geography, target_geog, radius_m)` dan `ST_Distance(geom::geography, target_geog)`.
- **Indeks Spasial:** Dibuat indeks GiST fungsional pada ekspresi geografi:
  ```sql
  CREATE INDEX idx_delivery_stops_geog ON delivery_stops USING GIST (((geom)::geography));
  CREATE INDEX idx_location_points_geog ON location_points USING GIST (((geom)::geography));
  CREATE INDEX idx_emergencies_geog ON emergencies USING GIST (((geom)::geography));
  ```
  Ini menjamin `EXPLAIN ANALYZE` menghasilkan `Bitmap Index Scan on idx_..._geog` untuk seluruh kueri jarak berbasis meter.

### 2.2 Universal Database-Enforced Coordinate Synchronization
Trigger PostgreSQL `sync_point_geom_trigger` dipasang pada `delivery_stops`, `location_points`, dan `emergencies`:
```sql
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
```

### 2.3 Two-Tier Idempotency Architecture
1. **Tier 1: HTTP API Gateway Idempotency (`idempotency_records`):**
   - Composite unique key: `@@unique([key, userId, endpoint])`.
   - Menyimpan status code dan response JSON envelope selama 24 jam. Mencegah mutasi ganda pada retry jaringan HTTP.
2. **Tier 2: Domain Event Sourcing Idempotency (`delivery_events.idempotency_key`):**
   - Unique constraint pada kolom `idempotency_key` (UUID).
   - Menjamin bahwa satu mutasi event lapangan (misal: stop complete) hanya dicatat 1 kali dalam log append-only meskipun di-flush via batch sync offline.

### 2.4 Active Assignment Overlap Prevention
Partial Unique Indexes pada PostgreSQL:
```sql
CREATE UNIQUE INDEX idx_unique_active_vehicle_assignment
  ON vehicle_assignments (vehicle_id) WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX idx_unique_active_driver_assignment
  ON vehicle_assignments (driver_id) WHERE status = 'ACTIVE';
```

### 2.5 Partition Lifecycle & Observability Alert
- Tabel `location_points` dipartisi bulanan dengan fallback `location_points_default`.
- **Observability Rule:** Metrik `location_points_default_count` diexpose via health check. Jika count > 0, sistem mengirimkan alert warning bahwa partisi bulanan baru perlu di-create dan data di-drain ke partisi baru.

---

## 3. Migration Structure
1. `20260902000001_init_postgis_relational`: PostGIS extension + master schema (`roles`, `permissions`, `users`, `drivers`, `vehicles`, `assignments`, `devices`, `sessions`, `prekeys`).
2. `20260902000002_spatial_logistics_and_partitions`: Operational logistics + partitioned `location_points` + GiST expression indexes + sync triggers + checks.
