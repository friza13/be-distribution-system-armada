# Phase 5: Route Optimization, Routing Provider & 2-Opt — Reconciliation Report

**Document Version:** 1.0.0
**Date:** 2026-09-02
**Author:** AI Engineering Agent (BE & Security Lead)
**Status:** APPROVED & EXECUTING

---

## 1. Executive Summary

Phase 5 membangun lapisan abstraksi provider rute (*RoutingProvider*), mesin optimasi rute (*RouteOptimizerEngine*) dengan pencarian eksaustif untuk $N \le 5$ titik stop dan algoritma Nearest-Neighbor + 2-Opt local search untuk $N > 5$ titik stop, penataan urutan manual (*manual stop reordering*), manajemen versi rute yang ter-immutable, resiliensi fallback geodesik Haversine saat provider eksternal bermasalah, otorisasi IDOR terproteksi, serta penyiaran realtime via WebSocket saat rute aktif diperbarui.

---

## 2. Completed Milestones Baseline (Phase 0–4)

```text
Phase 0: Foundation & Core Scaffold          --> [CLOSED & VERIFIED] (8bd990c)
Phase 1: Database & PostGIS Spatial Core     --> [CLOSED & VERIFIED] (f69d5a5)
Phase 2: Auth, RBAC, Sessions & Key Mgmt     --> [CLOSED & VERIFIED] (6450af7)
Phase 3: Realtime Infrastructure (Socket.IO) --> [CLOSED & VERIFIED] (822d855)
Phase 4: Telemetry, GPS Streaming & Fleet    --> [CLOSED & VERIFIED] (6e7ef12)
Phase 5: Route Optimization & 2-Opt/OSRM     --> [IN PROGRESS / BUILDING]
```

---

## 3. Existing Schema Audit & Verification

### 3.1 Existing Prisma Models (`prisma/schema.prisma`)

| Model / Table | Relevant Columns | Status |
|---|---|---|
| `Route` (`routes`) | `id`, `deliveryId`, `version`, `source`, `totalDistanceM`, `estimatedDurationS`, `polylineGeojson`, `selectedAt` | ✅ EXISTS (`@@unique([deliveryId, version])`) |
| `RouteStop` (`route_stops`) | `id`, `routeId`, `deliveryStopId`, `sequence` | ✅ EXISTS (`@@unique([routeId, sequence])`, `@@unique([routeId, deliveryStopId])`) |
| `DeliveryStop` (`delivery_stops`) | `id`, `deliveryId`, `sequence`, `destinationName`, `address`, `latitude`, `longitude`, `geom`, `geofenceRadiusM`, `status` | ✅ EXISTS (`@@unique([deliveryId, sequence])`) |
| `Delivery` (`deliveries`) | `id`, `deliveryCode`, `driverId`, `vehicleId`, `status`, `routeMode`, `createdBy` | ✅ EXISTS |

**Kesimpulan Schema Audit:**
Skema database PostgreSQL yang ada pada Phase 1 telah 100% mencukupi kebutuhan *route versioning* dan *route stops mapping*. **Tidak ada migrasi database baru yang diperlukan.**

---

## 4. Key Engineering & Reconciliation Decisions

1. **Routing Provider Abstraction:**
   - Interface `RoutingProvider` menyediakan abstraksi provider jalan raya.
   - Provider bawaan: `OsrmRoutingProvider` (mengirim HTTP request ke OSRM Table/Route API dengan timeout 3000ms).
   - Provider fallback: `HaversineRoutingProvider` (kalkulasi geodesik Haversine deterministik offline jika OSRM timeout, error 5xx/4xx, atau tidak dapat dijangkau).
2. **Optimization Threshold & Objective Function:**
   - Objective Function: Meminimalkan total **durasi perjalanan (detik)** dan **jarak (meter)**.
   - **$N \le 5$ Stops:** **Exhaustive Permutation Search** ($N!$ evaluasi, max 120 periksa). Dijamin 100% global optimum secara deterministik.
   - **$N > 5$ Stops:** **Nearest-Neighbor Initial Construction** + **2-Opt Local Search Improvement** (maksimal 100 iterasi atau `improvement < 0.001`).
3. **Origin & Destination Semantics:**
   - Origin rute dapat berasal dari lokasi terkini Driver (jika ada di Redis cache `driver:location:latest:<driverId>`) atau titik stop pertama.
   - Tie-breaking deterministik berdasarkan UUID `deliveryStopId` secara alfabetis jika terdapat cost yang sama.
4. **Route Versioning & Immutability:**
   - Versi rute disimpan secara bertahap (`version = max(existing_version) + 1`).
   - Rute terdahulu tidak pernah di-overwrite untuk mendukung audit dan penelusuran riwayat.
5. **Security, IDOR Defense & Rate Limit:**
   - `JwtAuthGuard` + `@Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')`.
   - Driver A hanya dapat merekomendasikan/memilih/mengatur rute untuk Delivery yang ditugaskan padanya (`delivery.driverId === req.user.driverId`).
   - Rate limit 5 request per 60 detik per delivery untuk mencegah *algorithmic DoS*.
6. **Realtime Broadcast:**
   - Saat rute aktif dipilih (`POST /v1/deliveries/:id/routes/select`) atau diurutkan manual (`PATCH /v1/deliveries/:id/routes/reorder`), gateway realtime memancarkan event `delivery.route.updated` ke room WebSocket `delivery:<deliveryId>`.

---

## 5. Scope Boundary

### In-Scope (Phase 5 MVP)
- `RoutingProvider` interface & `OsrmRoutingProvider` + `HaversineRoutingProvider` fallback.
- `RouteOptimizerEngine` ($N \le 5$ Exhaustive, $N > 5$ Nearest-Neighbor + 2-Opt).
- Route Versioning & Immutability persisten.
- REST Endpoints:
  - `POST /v1/deliveries/:id/routes/recommend`
  - `POST /v1/deliveries/:id/routes/select`
  - `PATCH /v1/deliveries/:id/routes/reorder`
  - `GET /v1/deliveries/:id/routes/current`
  - `GET /v1/deliveries/:id/routes/versions`
- Penyiaran event WebSocket `delivery.route.updated`.
- Dokumen API kanonikal & OpenAPI update.

### Out-of-Scope (Deferred to Later Phases)
- Multi-depot Vehicle Routing Problem (VRP) dengan multiple vehicles (Phase 6).
- Time window constraints per stop (Phase 6).
- Realtime traffic live re-routing otomatis saat kemacetan (Phase 10).
