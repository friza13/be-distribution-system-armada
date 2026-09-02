# ORM & PostGIS Spatial Query Evaluation Spike

**Spike ID:** `BE-CORE-003` / `ADR-001`  
**Purpose:** Menguji dan membandingkan performa, dukungan tipe spasial PostGIS (`geometry(Point, 4326)`), kemudahan migrasi skema, dan integritas transaksi ACID pada kandidat ORM (Prisma, Drizzle, TypeORM).  
**Execution:** `npm run spike:orm`

## Evaluated Criteria
1. Spatial Point insertion (`ST_SetSRID(ST_MakePoint(lng, lat), 4326)`).
2. Spatial Radius Geofence search (`ST_DWithin`).
3. Spatial Distance calculation (`ST_Distance`).
4. Schema migration lifecycle & GiST spatial index generation.
5. Memory footprint and ACID transaction isolation.
