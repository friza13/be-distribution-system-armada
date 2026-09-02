# Phase 4: Telemetry, GPS Streaming & Fleet Monitoring — Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun pipeline ingesti telemetri GPS terpadu (REST + WebSocket) dari smartphone Driver, cache Redis latest-location, streaming realtime ke fleet monitoring, dan REST API fleet & location history dengan otorisasi anti-IDOR yang aman, tanpa meregresikan Phase 0–3.

**Architecture:** NestJS `TrackingModule`, `LocationValidationService`, `TrackingCacheService`, `tracking.controller.ts`, `fleet.controller.ts`, PostGIS `$executeRaw`, `RedisService`, `RealtimeGateway`.

---

## Unified Ingestion Flow

Both REST (`POST /v1/me/location`) and WebSocket (`driver.location.update`) delegate business execution to `TrackingService.processTelemetry()`.

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
                                                   │
                                            ┌──────┴──────┐
                                            ▼             ▼
                                       Redis Cache    Realtime Broadcast
```

---

## File Structure Map

```text
backend/
├── src/
│   └── modules/
│       ├── tracking/
│       │   ├── dto/
│       │   │   ├── location-ingestion.dto.ts         [CREATE - Task 4.1]
│       │   │   └── location-batch-ingestion.dto.ts   [CREATE - Task 4.1]
│       │   ├── utils/
│       │   │   └── gps-validator.util.ts             [CREATE - Task 4.1]
│       │   ├── services/
│       │   │   ├── location-validation.service.ts    [CREATE - Task 4.1]
│       │   │   ├── tracking.service.ts               [CREATE - Task 4.2]
│       │   │   └── tracking-cache.service.ts         [CREATE - Task 4.3]
│       │   ├── tracking.controller.ts                [CREATE - Task 4.2]
│       │   └── tracking.module.ts                    [CREATE - Task 4.2]
│       └── fleet/
│           ├── dto/
│           │   └── location-history-query.dto.ts     [CREATE - Task 4.4]
│           ├── fleet.service.ts                      [CREATE - Task 4.4]
│           ├── fleet.controller.ts                   [CREATE - Task 4.4]
│           └── fleet.module.ts                       [CREATE - Task 4.4]
├── test/
│   └── tracking/
│       ├── gps-validation.spec.ts                    [CREATE - Task 4.1]
│       ├── location-rest-ingest.e2e-spec.ts          [CREATE - Task 4.2]
│       ├── ws-telemetry-streaming.e2e-spec.ts        [CREATE - Task 4.3]
│       └── fleet-monitoring.e2e-spec.ts              [CREATE - Task 4.4]
```

---

## Task 4.1: GPS Validation DTOs & Pipeline (`TELEMETRY-001`)

**Files:**
- Create: `backend/src/modules/tracking/dto/location-ingestion.dto.ts`
- Create: `backend/src/modules/tracking/dto/location-batch-ingestion.dto.ts`
- Create: `backend/src/modules/tracking/utils/gps-validator.util.ts`
- Create: `backend/src/modules/tracking/services/location-validation.service.ts`
- Create: `backend/test/tracking/gps-validation.spec.ts`

- [ ] **Step 1: Buat `location-ingestion.dto.ts`**
  - Validation rules: latitude (-90..90), longitude (-180..180), accuracyM (0..50), recordedAt (ISO-8601)

- [ ] **Step 2: Buat `location-batch-ingestion.dto.ts`**
  - Array of DTOs, `@ArrayMinSize(1)`, `@ArrayMaxSize(50)`

- [ ] **Step 3: Buat `gps-validator.util.ts`**
  - Bounds, accuracy <= 50m, clock skew (-1h..+5m), Haversine speed calculation, velocity anomaly threshold (150 km/h)

- [ ] **Step 4: Buat `LocationValidationService`**
  - Fetch previous cached point from Redis, validate single point

- [ ] **Step 5: Tulis Unit Tests `gps-validation.spec.ts`**

---

## Task 4.2: REST Telemetry Ingestion Endpoint (`TELEMETRY-002`)

**Files:**
- Create: `backend/src/modules/tracking/services/tracking.service.ts`
- Create: `backend/src/modules/tracking/tracking.controller.ts`
- Create: `backend/src/modules/tracking/tracking.module.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/test/tracking/location-rest-ingest.e2e-spec.ts`

- [ ] **Step 1: Buat `tracking.service.ts`**
  - Unified `processTelemetry(dto, driverId, userRole, deviceId, sessionId)`
  - Delivery ownership validation (`delivery.driverId === driverId`)
  - Race-safe idempotency handling via `idempotency_records` unique constraint
  - Raw PostGIS persistence to `location_points`

- [ ] **Step 2: Buat `tracking.controller.ts`**
  - `POST /v1/me/location` (`@Roles('DRIVER')`)
  - `POST /v1/me/location/batch` (`@Roles('DRIVER')`)

- [ ] **Step 3: Buat `tracking.module.ts`** dan daftarkan di `app.module.ts`

- [ ] **Step 4: Tulis E2E Test `location-rest-ingest.e2e-spec.ts`**

---

## Task 4.3: Redis Telemetry Cache & Realtime Live Map Streaming (`TELEMETRY-003`)

**Files:**
- Create: `backend/src/modules/tracking/services/tracking-cache.service.ts`
- Modify: `backend/src/modules/realtime/gateways/realtime.gateway.ts`
- Create: `backend/test/tracking/ws-telemetry-streaming.e2e-spec.ts`

- [ ] **Step 1: Buat `TrackingCacheService`**
- [ ] **Step 2: Implementasi WS `@SubscribeMessage('driver.location.update')` memanggil `TrackingService.processTelemetry()`**
- [ ] **Step 3: Broadcast canonical event `driver.location.updated` ke room `fleet:monitoring` & `delivery:<id>`**
- [ ] **Step 4: Tulis E2E Test `ws-telemetry-streaming.e2e-spec.ts`**

---

## Task 4.4: Fleet Live Monitoring & Location History APIs (`TELEMETRY-004`)

**Files:**
- Create: `backend/src/modules/fleet/dto/location-history-query.dto.ts`
- Create: `backend/src/modules/fleet/fleet.service.ts`
- Create: `backend/src/modules/fleet/fleet.controller.ts`
- Create: `backend/src/modules/fleet/fleet.module.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/test/tracking/fleet-monitoring.e2e-spec.ts`
- Update: `distribution-system-docs/api/TELEMETRY-API-CONTRACT.md`
- Update: `distribution-system-docs/api/FLEET-API-CONTRACT.md`
- Update: `distribution-system-docs/openapi/openapi.yaml`

- [ ] **Step 1: Buat DTO, Fleet Service & Controller**
  - `GET /v1/fleet/locations`: Admin, Super Admin, Owner (Driver ditolak 403 `FLEET_ACCESS_DENIED`)
  - `GET /v1/drivers/:id/location-history`: Admin, Super Admin, Owner (company scope), Driver (ONLY IF `:id === req.user.driverId`)
- [ ] **Step 2: Update API docs & OpenAPI**
- [ ] **Step 3: Tulis E2E Test `fleet-monitoring.e2e-spec.ts`**

---

## Rollback Considerations
- Modul `TrackingModule` dan `FleetModule` bersifat aditif. Jika terjadi masalah, modul dapat di-disable dari `AppModule` tanpa merusak Phase 0–3.
- Database skema `location_points` dari Phase 1 tidak diubah.
