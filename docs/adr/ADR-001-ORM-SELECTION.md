# ADR-001: ORM & Database Migration Engine Selection for PostgreSQL + PostGIS

- **Status:** ACCEPTED
- **Deciders:** BE Lead, Security Lead, Team Architecture
- **Date:** 2026-09-02
- **Technical Context:** Modular Monolith NestJS, PostgreSQL 16 + PostGIS 3.4, Node.js 22 LTS, VPS Staging 2 vCPU / 2 GB RAM.

---

## 1. Context & Problem Statement

Sistem Distribution Management System membutuhkan layer akses database relasional yang mendukung:
1. Skema relasional kompleks dengan foreign key constraints dan transaksi ACID untuk alokasi pengiriman dan state machine (`deliveries`, `stops`, `vehicles`, `drivers`).
2. Kolom spasial PostGIS native `geometry(Point, 4326)` pada tabel `delivery_stops` dan `location_points`.
3. Query spasial berkecepatan tinggi: pencarian radius geofence (`ST_DWithin`), kalkulasi jarak (`ST_Distance`), dan indeks spasial GiST (`idx_location_points_geom`).
4. Automated schema migration lifecycle yang aman, dapat di-rollback, dan dapat dijalankan otomatis pada CI/CD.
5. Efisiensi memori (memory footprint rendah) agar aman dijalankan pada VPS staging 2 GB RAM.

---

## 2. Evaluated Candidates

### Option A: Prisma ORM (with Typed Raw SQL PostGIS Helpers) — [CHOSEN]
- **Kelebihan:** Type-safety sangat kuat, auto-generated Prisma Client, ecosystem tools mature, developer experience tinggi untuk relasi CRUD, transaction boundaries (`$transaction`) sangat andal.
- **Dukungan PostGIS:** Kolom PostGIS didefinisikan sebagai `Unsupported("geometry(Point, 4326)")` pada skema Prisma. Query spasial kompleks (`ST_DWithin`, `ST_Distance`) dieksekusi secara aman menggunakan parameterized `$queryRaw` template tag (`Prisma.sql`).
- **Memory Footprint:** Prisma Rust Query Engine binary stabil pada ~30-40 MB RAM, aman untuk VPS 2 GB.

### Option B: Drizzle ORM
- **Kelebihan:** Sangat ringan (zero binary overhead, pure TypeScript), first-class custom types dan support PostGIS geometry columns.
- **Kekurangan:** Ekosistem tooling NestJS dan generator CRUD masih memerlukan boilerplate wrapper manual.

### Option C: TypeORM
- **Kelebihan:** Dekorator bawaan `@Column('geometry')`.
- **Kekurangan:** Riwayat masalah sinkronisasi migrasi skema dan potensi memory leak pada relasi kompleks.

---

## 3. Decision & Rationale

Tim memutuskan untuk mengadopsi **Prisma ORM** sebagai engine database dan migrasi utama, dengan konvensi query spasial terstandarisasi:
1. **Migrations:** Seluruh migrasi skema dikelola melalui `prisma migrate`. Kolom `geom` diinisialisasi sebagai tipe `geometry(Point, 4326)` dan diindeks dengan GiST (`CREATE INDEX ... USING GIST (geom);`).
2. **Standard CRUD:** Operasi relasional (User, Driver, Vehicle, Delivery, Audit) menggunakan Prisma Client typesafe methods (`findMany`, `create`, `update`).
3. **Spatial Queries:** Operasi spasial (Geofence detection, distance matrix calculation, nearest driver) menggunakan parameterized helper function berbasis `$queryRaw` untuk menjamin keamanan 100% dari SQL Injection.

---

## 4. Canonical Spatial Query Patterns

```typescript
// 1. Point Ingestion & Insert
await prisma.$executeRaw`
  INSERT INTO location_points (id, driver_id, geom, accuracy_m, speed_mps, heading_deg, recorded_at, received_at)
  VALUES (${id}, ${driverId}, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), ${accuracyM}, ${speedMps}, ${headingDeg}, ${recordedAt}, NOW())
`;

// 2. Geofence Proximity Check (ST_DWithin with Geography casting)
const result = await prisma.$queryRaw<Array<{ is_within: boolean }>>`
  SELECT ST_DWithin(
    ST_SetSRID(ST_MakePoint(${driverLng}, ${driverLat}), 4326)::geography,
    geom::geography,
    ${radiusM}
  ) AS is_within
  FROM delivery_stops
  WHERE id = ${stopId}
`;

// 3. Distance Calculation in Meters (ST_Distance with Geography casting)
const distance = await prisma.$queryRaw<Array<{ distance_meters: number }>>`
  SELECT ST_Distance(
    ST_SetSRID(ST_MakePoint(${lng1}, ${lat1}), 4326)::geography,
    ST_SetSRID(ST_MakePoint(${lng2}, ${lat2}), 4326)::geography
  ) AS distance_meters
`;
```

---

## 5. Consequences & Next Steps

- **Phase 1 Execution:** Menginisialisasi `prisma/schema.prisma` dan baseline migration PostGIS pada Task `DB-GEO-001`.
- **Security:** Seluruh spatial query wajib menggunakan tag parameterized `Prisma.sql` (tidak boleh menggunakan string concatenation).
