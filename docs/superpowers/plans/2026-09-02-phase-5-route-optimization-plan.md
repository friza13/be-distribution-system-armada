# Phase 5: Route Optimization, Routing Provider & 2-Opt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun modul perutean presisi tingi (*Route Optimization Subsystem*), mencakup abstraksi provider OSRM + fallback Haversine, algoritma optimasi rute ($N \le 5$ Exhaustive Permutation & $N > 5$ Nearest-Neighbor + 2-Opt), manajemen versi rute yang ter-immutable, otorisasi IDOR terproteksi, serta penyiaran realtime via WebSocket saat rute aktif diperbarui.

**Architecture:** NestJS `RoutesModule`, `RoutingService`, `OsrmRoutingProvider`, `HaversineRoutingProvider`, `RouteOptimizerService`, `routes.controller.ts`, Prisma Client, `RealtimeGateway`.

**Tech Stack:** Node.js 22 LTS, NestJS 10, Prisma 5.22.0, PostgreSQL 16 + PostGIS 3.4, Redis 7, Socket.IO 4.

---

## Global Constraints

- **No Database Migration Required:** Skema database `routes` dan `route_stops` dari Phase 1 sudah 100% mendukung.
- **Provider Timeout:** Request ke OSRM dibatasi maksimum 3000ms dengan fallback otomatis ke Haversine.
- **Strict Role & IDOR Guards:** Driver hanya dapat mengakses rute delivery yang ditugaskan padanya.
- **Deterministic Output:** Hasil optimasi bersifat deterministik dengan tie-breaking UUID alfabetis.
- **Zero Secret Logging:** Tidak mencetak API key atau kredensial ke log.

---

## File Structure Map

```text
backend/
├── src/
│   └── modules/
│       └── routes/
│           ├── dto/
│           │   ├── recommend-route.dto.ts            [CREATE - Task 5.3]
│           │   ├── select-route.dto.ts               [CREATE - Task 5.3]
│           │   └── manual-reorder.dto.ts             [CREATE - Task 5.3]
│           ├── interfaces/
│           │   └── routing-provider.interface.ts     [CREATE - Task 5.1]
│           ├── providers/
│           │   ├── osrm-routing.provider.ts          [CREATE - Task 5.1]
│           │   └── haversine-routing.provider.ts     [CREATE - Task 5.1]
│           ├── utils/
│           │   ├── exhaustive-permutation.util.ts    [CREATE - Task 5.2]
│           │   └── nearest-neighbor-2opt.util.ts     [CREATE - Task 5.2]
│           ├── services/
│           │   ├── routing.service.ts                [CREATE - Task 5.1]
│           │   ├── route-optimizer.service.ts        [CREATE - Task 5.2]
│           │   └── routes-domain.service.ts          [CREATE - Task 5.3]
│           ├── routes.controller.ts                  [CREATE - Task 5.3]
│           └── routes.module.ts                      [CREATE - Task 5.3]
├── test/
│   └── routes/
│       ├── routing-provider.spec.ts                  [CREATE - Task 5.1]
│       ├── route-optimizer.spec.ts                   [CREATE - Task 5.2]
│       ├── routes-rest.e2e-spec.ts                   [CREATE - Task 5.3]
│       └── ws-route-broadcast.e2e-spec.ts            [CREATE - Task 5.4]
└── src/
    └── app.module.ts                                 [MODIFY - Task 5.3]
```

---

## Task Breakdown & Bite-Sized Steps

---

### Task 5.1: Routing Provider Abstraction & Distance Matrix Engine (`ROUTE-001`)

**Files:**
- Create: `backend/src/modules/routes/interfaces/routing-provider.interface.ts`
- Create: `backend/src/modules/routes/providers/haversine-routing.provider.ts`
- Create: `backend/src/modules/routes/providers/osrm-routing.provider.ts`
- Create: `backend/src/modules/routes/services/routing.service.ts`
- Create: `backend/test/routes/routing-provider.spec.ts`

- [ ] **Step 1: Interface `routing-provider.interface.ts`**
  Definisikan `Waypoint`, `DistanceMatrixResult`, `RouteGeometryResult`, dan interface `RoutingProvider`.

- [ ] **Step 2: Implementasi `HaversineRoutingProvider`**
  Hitung matriks jarak geodesik $N \times N$ menggunakan rumus Haversine. Asumsikan durasi berdasar $30\text{ km/jam}$ ($8.33\text{ m/s}$).

- [ ] **Step 3: Implementasi `OsrmRoutingProvider`**
  Kirim HTTP GET request ke OSRM `/table/v1/driving/` dan `/route/v1/driving/` dengan timeout 3000ms. Tangkap error network/timeout dan fallback ke `HaversineRoutingProvider`.

- [ ] **Step 4: Implementasi `RoutingService`**
  Manager provider yang membungkus pemanggilan OSRM dengan fallback otomatis ke Haversine.

- [ ] **Step 5: Tulis Unit Test `routing-provider.spec.ts`**
  Uji kalkulasi Haversine matrix, mock OSRM success, mock OSRM timeout $\rightarrow$ fallback Haversine.

---

### Task 5.2: Route Optimization Engine ($N \le 5$ Exhaustive & $N > 5$ 2-Opt) (`ROUTE-002`)

**Files:**
- Create: `backend/src/modules/routes/utils/exhaustive-permutation.util.ts`
- Create: `backend/src/modules/routes/utils/nearest-neighbor-2opt.util.ts`
- Create: `backend/src/modules/routes/services/route-optimizer.service.ts`
- Create: `backend/test/routes/route-optimizer.spec.ts`

- [ ] **Step 1: Utilities `exhaustive-permutation.util.ts` & `nearest-neighbor-2opt.util.ts`**
  - Implementasikan evaluasi $N!$ permutasi untuk $N \le 5$.
  - Implementasikan algoritma Nearest-Neighbor + 2-Opt local search untuk $N > 5$ (cap 100 iterasi).

- [ ] **Step 2: Implementasi `RouteOptimizerService`**
  Kombinasikan matriks dari `RoutingService` dengan algoritma yang sesuai berdasarkan jumlah stop $N$.

- [ ] **Step 3: Tulis Unit Test `route-optimizer.spec.ts`**
  Uji optimasi 3, 5, 8 titik stop. Verifikasi determinisme hasil tie-breaking.

---

### Task 5.3: Route Domain Service & REST Endpoints (`ROUTE-003`)

**Files:**
- Create DTOs: `recommend-route.dto.ts`, `select-route.dto.ts`, `manual-reorder.dto.ts`
- Create: `backend/src/modules/routes/services/routes-domain.service.ts`
- Create: `backend/src/modules/routes/routes.controller.ts`
- Create: `backend/src/modules/routes/routes.module.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/test/routes/routes-rest.e2e-spec.ts`

- [ ] **Step 1: DTOs & Validation**
  Class-validator DTOs dengan whitelist ketat.

- [ ] **Step 2: `RoutesDomainService`**
  - `recommendRoute(deliveryId, actor)`: Hitung rekomendasi rute tanpa menyimpan ke DB.
  - `selectRoute(deliveryId, dto, actor)`: Simpan rute baru dengan `version = max + 1` dalam transaksi DB.
  - `reorderStops(deliveryId, dto, actor)`: Urutkan stop manual dan set `routeMode = MANUAL`.
  - `getCurrentRoute(deliveryId, actor)`: Ambil rute versi terbaru.
  - `getRouteVersions(deliveryId, actor)`: Ambil riwayat versi rute.

- [ ] **Step 3: `RoutesController`**
  Route mapping pada `/v1/deliveries/:id/routes/*` dengan `JwtAuthGuard`, `RolesGuard`, dan penegakan IDOR driver.

- [ ] **Step 4: Tulis E2E Test `routes-rest.e2e-spec.ts`**
  Uji recommend, select, reorder, version increment, dan penolakan IDOR Driver A ke Delivery B.

---

### Task 5.4: Realtime Route Broadcast & API Documentation (`ROUTE-004`)

**Files:**
- Modify: `backend/src/modules/routes/services/routes-domain.service.ts`
- Create: `backend/test/routes/ws-route-broadcast.e2e-spec.ts`
- Create: `distribution-system-docs/api/ROUTE-API-CONTRACT.md`
- Update: `distribution-system-docs/openapi/openapi.yaml`
- Update: `distribution-system-docs/06-API-REALTIME.md`

- [ ] **Step 1: Realtime Broadcast**
  Integrasikan `RealtimeGateway.server.to('delivery:<id>').emit('delivery.route.updated', envelope)` saat rute dipilih atau di-reorder.

- [ ] **Step 2: Tulis E2E Test `ws-route-broadcast.e2e-spec.ts`**

- [ ] **Step 3: Update Dokumentasi API & OpenAPI**

---

## Verification & Final Gates

```bash
npm run test       # Unit tests (Password, Log Sanitizer, Pagination, GPS, Routing)
npm run test:e2e   # Full E2E regression (Phase 0–5, 31+ test suites)
npm run build      # NestJS production build (Exit code 0)
```
