# Phase 5: Route Optimization, Routing Provider & 2-Opt — Design Specification

**Document Version:** 1.0.0
**Target Milestone:** Phase 5 Implementation Ready
**Date:** 2026-09-02
**Author:** AI Engineering Agent (BE & Security Lead)

---

## 1. Executive Summary & Goals

Phase 5 merancang dan mengimplementasikan modul optimasi perutean armada (*Route Optimization Subsystem*). Sub-sistem ini bertugas menghitung rekomendasi urutan stop yang paling efisien berdasarkan matriks jarak/waktu jaringan jalan, mendukung penataan urutan manual oleh penggunanya, mengelola versi rute yang ter-immutable, serta menjamin resiliensi tinggi melalui mekanisme fallback otomatis.

---

## 2. Architecture & System Boundary

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 5 ROUTE OPTIMIZATION ARCHITECTURE                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Routing Provider Abstraction Layer:                                      │
│    - RoutingProvider (Interface)                                            │
│    - OsrmRoutingProvider (Primary HTTP client, timeout 3000ms)              │
│    - HaversineRoutingProvider (Offline Geodesic Fallback)                   │
│ 2. Optimization Engine (RouteOptimizerEngine):                              │
│    - Small N (N <= 5 stops): Exhaustive Permutation Search (N! checks)       │
│    - Larger N (N > 5 stops): Nearest-Neighbor + 2-Opt Local Search           │
│ 3. Domain Service & Route Versioning (RoutesService):                       │
│    - Recommends optimal stop sequence                                       │
│    - Selects & persists new route version (version = max + 1)               │
│    - Reorders stops manually (RouteMode.MANUAL)                             │
│    - Enforces Anti-IDOR & Delivery Ownership Guards                         │
│ 4. Realtime Integration (RealtimeGateway):                                  │
│    - Broadcasts 'delivery.route.updated' to room 'delivery:<deliveryId>'    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Routing Provider Abstraction

### 3.1 Interface Definition

```typescript
export interface Waypoint {
  id: string;
  latitude: number;
  longitude: number;
}

export interface DistanceMatrixResult {
  distancesMeters: number[][];   // Matrix N x N distance in meters
  durationsSeconds: number[][];  // Matrix N x N duration in seconds
  provider: 'OSRM' | 'HAVERSINE_FALLBACK';
}

export interface RouteGeometryResult {
  totalDistanceM: number;
  estimatedDurationS: number;
  polylineGeojson: Record<string, any>;
  provider: 'OSRM' | 'HAVERSINE_FALLBACK';
}

export interface RoutingProvider {
  getDistanceMatrix(waypoints: Waypoint[]): Promise<DistanceMatrixResult>;
  getRouteGeometry(waypoints: Waypoint[]): Promise<RouteGeometryResult>;
}
```

### 3.2 OSRM & Fallback Policy
1. **OsrmRoutingProvider:** Mengirim request HTTP ke OSRM Table API (`/table/v1/driving/`) & Route API (`/route/v1/driving/`).
2. **Timeout:** Bounded HTTP timeout **3000ms**.
3. **Resilience Fallback:** Jika OSRM gagal (timeout, error 4xx/5xx, malformed response, atau network down), provider secara otomatis mengalihkan komputasi ke `HaversineRoutingProvider`.
4. **Haversine Matrix Calculation:** Menggunakan rumus Haversine geodesik dengan asumsi kecepatan rata-rata kendaraan $30\text{ km/jam}$ ($8.33\text{ m/s}$) untuk estimasi durasi fallback.

---

## 4. Optimization Engine Algorithms

### 4.1 Small Stop Count ($N \le 5$ Stops): Exhaustive Permutation Search
- Meng-generate seluruh $N!$ permutasi titik stop.
- Untuk $N = 5$, jumlah permutasi adalah $5! = 120$ pasang evaluasi.
- Menghitung total cost $\sum \text{duration}(S_i, S_{i+1})$ untuk setiap permutasi.
- **Dijamin 100% mendapatkan global optimum.**

### 4.2 Larger Stop Count ($N > 5$ Stops): Nearest-Neighbor + 2-Opt
- **Langkah 1 (Konstruksi Awal Nearest-Neighbor):**
  - Dimulai dari titik Origin (lokasi driver/titik pertama).
  - Pilih titik terdekat yang belum dikunjungi berdasarkan distance matrix hingga seluruh titik terhubung.
- **Langkah 2 (Perbaikan Lokal 2-Opt):**
  - Melakukan swap dua edge $(i, i+1)$ dan $(j, j+1)$ untuk menghilangkan persilangan rute.
  - Iterasi berhenti jika `improvement < 0.001` atau mencapai **cap maksimum 100 iterasi**.
- **Determinisme:** Jika dua rute memiliki cost yang sama, tie-breaking dilakukan secara deterministik dengan mengurutkan UUID `deliveryStopId` secara alfabetis.

---

## 5. Route Versioning & Data Persistence

- Rute disimpan pada tabel `routes` dan `route_stops`.
- Setiap rute baru yang dipilih mendapat nomor `version` bertambah (`version = previous_version + 1`).
- Rute lama dipertahankan untuk kebutuhan audit & riwayat operasional.

---

## 6. Security, IDOR Defense & Rate Limiting

- **Endpoint Authorization:**
  - `POST /v1/deliveries/:id/routes/recommend`
  - `POST /v1/deliveries/:id/routes/select`
  - `PATCH /v1/deliveries/:id/routes/reorder`
  - `GET /v1/deliveries/:id/routes/current`
  - `GET /v1/deliveries/:id/routes/versions`
- **IDOR Check:**
  - Role `DRIVER`: Wajib terdaftar sebagai `delivery.driverId === req.user.driverId`. Jika tidak $\rightarrow$ `403 FORBIDDEN (RESOURCE_FORBIDDEN)`.
  - Role `OWNER`: Delivery wajib berada dalam scope perusahaan milik Owner.
- **Rate Limit:** 5 request optimasi per 60 detik per delivery ID untuk mencegah *algorithmic DoS*.

---

## 7. Realtime Integration

Saat rute dipilih atau di-reorder secara manual, gateway realtime memancarkan event:
- **Event:** `delivery.route.updated`
- **Room:** `delivery:<deliveryId>`
- **Envelope:** Canonical Realtime Envelope v1
