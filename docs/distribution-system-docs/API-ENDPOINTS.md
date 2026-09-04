# Distribution Management System — Canonical REST API Master Reference

**Document Version:** 2.0.0 (Audited Runtime Source of Truth)  
**Milestone:** Phase 18 Final API Documentation & Handoff Gate  
**Date:** 2026-09-03  
**Target Audience:** Frontend Engineers (Admin Web, Owner Mobile, Driver Mobile), API Testers, Backend Developers, System Auditors  
**Repository Commit Audited:** `840dfd6` (Runtime Source of Truth)

---

## 1. Canonical Architecture & Authentication Overview

### 1.1 Global Configuration & Base Path
- **Global API Prefix:** `v1` (All REST endpoints are prefixed with `/v1/`)
- **Default Port:** `3000` (Environment variable `PORT=3000`)
- **Base URL (Local/Development):** `http://localhost:3000/v1`
- **Request Body Limits:** JSON maximum `100 KB`, URL-encoded maximum `50 KB`, Multipart stream maximum `10 MB` (enforced via `express.json` / `express.urlencoded` in `main.ts`).

### 1.2 Global Request Correlation ID (`x-request-id`)
- Every HTTP request passes through `RequestIdMiddleware`.
- If client sends header `x-request-id: <UUID>`, server preserves it; otherwise, server generates a new UUID v4.
- `x-request-id` is attached to response header `x-request-id` and embedded inside all error envelopes.

### 1.3 Authentication & Dual-Transport Architecture
1. **Mobile Clients (Owner Mobile & Driver Mobile Apps):**
   - **Access Token:** Sent via standard HTTP Header `Authorization: Bearer <access_token>` (Valid 15 minutes).
   - **Refresh Token:** Returned in JSON response body upon login/refresh and stored in secure device storage (Flutter Secure Storage).
2. **Admin Web (Browser SPA Surface):**
   - **Access Token:** Stored in-memory.
   - **Refresh Token:** Stored in `HttpOnly; Secure; SameSite=Strict; Path=/v1/auth` cookie `dms_refresh_token`.
   - **CSRF Protection:** Double-submit cookie `dms_csrf_token` issued via `GET /v1/auth/csrf` and verified via `x-csrf-token` header on state-mutating requests (`POST`, `PATCH`, `DELETE`, `PUT`).

### 1.4 Role System & Authorization Hierarchy
- `SUPER_ADMIN`: Full system administrative access, role elevation.
- `ADMIN`: User management, driver & vehicle management, audit log access, emergency override.
- `OWNER`: Distribution manager; creates deliveries, assigns drivers/vehicles, views fleet map, manages routes, communicates with assigned drivers.
- `DRIVER`: Field operation; accepts deliveries, executes stops, ingests GPS telemetry, uploads POD, triggers emergency SOS.

### 1.5 Object-Level Authorization & Anti-IDOR / Anti-BOLA Defense
- Server enforces resource-level ownership guards (`ObjectOwnershipGuard`, `DeliveryScopeValidator`, `DriverScopeValidator`).
- Driver A querying `/v1/deliveries/:id` assigned to Driver B is rejected with `403 Forbidden` (`code: RESOURCE_FORBIDDEN`).

### 1.6 Global Response Envelope Formats
#### Success Response Envelope (`HTTP 200 OK / 201 Created`):
```json
{
  "success": true,
  "data": {
    "id": "c1f7b8e2-4d2a-4f81-9b7e-8a9012345678",
    "status": "ASSIGNED"
  },
  "timestamp": "2026-09-03T06:30:00.000Z",
  "requestId": "e92409bd-1e94-474c-91c7-f9ad13fc98e7"
}
```

#### Error Response Envelope (`HTTP 400 / 401 / 403 / 404 / 409 / 413 / 429 / 500`):
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid username or password",
    "requestId": "e92409bd-1e94-474c-91c7-f9ad13fc98e7"
  },
  "timestamp": "2026-09-03T06:30:00.000Z"
}
```

---

## 2. Complete Inventory of Runtime Endpoints (59 Endpoints)

Below is the audited runtime inventory of all 59 REST endpoints enumerated directly from NestJS `@Controller()` definitions in `src/modules/`:

| No | Method | Actual Runtime Path | Controller | Auth | Roles | Scope | Status |
|:---:|:---:|:--- |:--- |:--- |:--- |:--- |:---:|
| **1. Auth & Session** | | | | | | | |
| 1 | `GET` | `/v1/auth/csrf` | `AuthController` | Public | Public | Browser Client Session | Verified |
| 2 | `POST` | `/v1/auth/login` | `AuthController` | Public | Public | Credential Authenticator | Verified |
| 3 | `POST` | `/v1/auth/refresh` | `AuthController` | CsrfGuard (Web) | Public | Token Family Rotation | Verified |
| 4 | `POST` | `/v1/auth/register` | `AuthController` | Public | Public | User Registration | Verified |
| 5 | `POST` | `/v1/auth/logout` | `AuthController` | CsrfGuard (Web) | Public | Active Session | Verified |
| 6 | `POST` | `/v1/auth/logout-all` | `AuthController` | CsrfGuard (Web) | Public | All User Sessions | Verified |
| **2. User & Account Lifecycle** | | | | | | | |
| 7 | `GET` | `/v1/users/me` | `UsersController` | Bearer JWT | Authenticated | Self Profile | Verified |
| 8 | `PATCH` | `/v1/users/:id/role` | `UsersController` | Bearer JWT | SUPER_ADMIN, ADMIN | User Role Management | Verified |
| 9 | `PATCH` | `/v1/users/:id/status` | `UsersController` | Bearer JWT | SUPER_ADMIN, ADMIN | User Account Status | Verified |
| 10 | `POST` | `/v1/users/:id/reset-password` | `UsersController` | Bearer JWT | SUPER_ADMIN, ADMIN | Admin Password Reset | Verified |
| **3. Device Management** | | | | | | | |
| 11 | `POST` | `/v1/devices/register` | `DeviceController` | Bearer JWT | Authenticated | Device Registration | Verified |
| 12 | `POST` | `/v1/devices/:id/revoke` | `DeviceController` | Bearer JWT | Authenticated | Device Revocation | Verified |
| 13 | `GET` | `/v1/devices/my-devices` | `DeviceController` | Bearer JWT | Authenticated | User Devices List | Verified |
| **4. E2EE Keys Subsystem (Path Correction: `/v1/e2ee/keys/*`)** | | | | | | | |
| 14 | `POST` | `/v1/e2ee/keys/register` | `E2eeKeysController` | Bearer JWT | Authenticated | Device Public Keys | Verified |
| 15 | `POST` | `/v1/e2ee/keys/prekeys` | `E2eeKeysController` | Bearer JWT | Authenticated | One-Time Prekeys Upload | Verified |
| 16 | `GET` | `/v1/e2ee/keys/bundle/:deviceId` | `E2eeKeysController` | Bearer JWT | Authenticated | Target Prekey Bundle | Verified |
| 17 | `GET` | `/v1/e2ee/keys/status/:deviceId` | `E2eeKeysController` | Bearer JWT | Authenticated | Prekey Count Status | Verified |
| **5. Deliveries & Dispatch** | | | | | | | |
| 18 | `POST` | `/v1/deliveries` | `DeliveriesController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER | Company Scope | Verified |
| 19 | `GET` | `/v1/deliveries/:id` | `DeliveriesController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER, DRIVER | Assigned Scope | Verified |
| 20 | `POST` | `/v1/deliveries/:id/assign` | `DeliveriesController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER | Company Scope | Verified |
| 21 | `POST` | `/v1/deliveries/:id/accept` | `DeliveriesController` | Bearer JWT | DRIVER | Assigned Driver Scope | Verified |
| 22 | `POST` | `/v1/deliveries/:id/start` | `DeliveriesController` | Bearer JWT | DRIVER | Assigned Driver Scope | Verified |
| 23 | `POST` | `/v1/deliveries/:id/complete` | `DeliveriesController` | Bearer JWT | DRIVER | Assigned Driver Scope | Verified |
| 24 | `POST` | `/v1/deliveries/:id/cancel` | `DeliveriesController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER | Company Scope | Verified |
| **6. Delivery Stops Lifecycle (Path Correction: `/v1/me/stops/*`)** | | | | | | | |
| 25 | `POST` | `/v1/me/stops/:id/depart` | `StopsController` | Bearer JWT | DRIVER | Assigned Stop Scope | Verified |
| 26 | `POST` | `/v1/me/stops/:id/arrive` | `StopsController` | Bearer JWT | DRIVER | Assigned Stop Scope | Verified |
| 27 | `POST` | `/v1/me/stops/:id/unload` | `StopsController` | Bearer JWT | DRIVER | Assigned Stop Scope | Verified |
| 28 | `POST` | `/v1/me/stops/:id/fail` | `StopsController` | Bearer JWT | DRIVER | Assigned Stop Scope | Verified |
| 29 | `POST` | `/v1/me/stops/:id/skip` | `StopsController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER, DRIVER | Permitted Scope | Verified |
| **7. Route Optimization (Path Correction: `/v1/deliveries/:id/routes/*`)** | | | | | | | |
| 30 | `POST` | `/v1/deliveries/:id/routes/recommend` | `RoutesController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER, DRIVER | Delivery Route Scope | Verified (OSRM + Haversine Failover) |
| 31 | `POST` | `/v1/deliveries/:id/routes/select` | `RoutesController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER, DRIVER | Delivery Route Scope | Verified (2-Opt TSP Selection) |
| 32 | `PATCH` | `/v1/deliveries/:id/routes/reorder` | `RoutesController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER, DRIVER | Delivery Route Scope | Verified (Manual Reordering) |
| 33 | `GET` | `/v1/deliveries/:id/routes/current` | `RoutesController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER, DRIVER | Delivery Route Scope | Verified (Active Version Geometry) |
| 34 | `GET` | `/v1/deliveries/:id/routes/versions` | `RoutesController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER, DRIVER | Delivery Route Scope | Verified (Immutable Audit History) |
| **8. GPS Telemetry Ingestion** | | | | | | | |
| 35 | `POST` | `/v1/me/location` | `TrackingController` | Bearer JWT | DRIVER | Driver Telemetry Scope | Verified |
| 36 | `POST` | `/v1/me/location/batch` | `TrackingController` | Bearer JWT | DRIVER | Driver Telemetry Scope | Verified |
| **9. Fleet & Location History** | | | | | | | |
| 37 | `GET` | `/v1/fleet/locations` | `FleetController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER | Company Fleet Scope | Verified |
| 38 | `GET` | `/v1/drivers/:id/location-history` | `FleetController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER, DRIVER | Target Driver Scope | Verified |
| **10. File Upload & Proof of Delivery (POD)** | | | | | | | |
| 39 | `POST` | `/v1/files/upload` | `PodController` | Bearer JWT | Authenticated | User Upload Scope | Verified |
| 40 | `GET` | `/v1/files/:id/download` | `PodController` | Bearer JWT | Authenticated | Authorized Proxy Scope | Verified |
| 41 | `POST` | `/v1/me/stops/:id/pod` | `PodController` | Bearer JWT | DRIVER | Assigned Stop Scope | Verified |
| 42 | `GET` | `/v1/deliveries/:id/pod` | `PodController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER, DRIVER | Delivery POD Scope | Verified |
| **11. E2EE Chat Conversations** | | | | | | | |
| 43 | `POST` | `/v1/conversations` | `ConversationsController` | Bearer JWT | Authenticated | Conversation Participant | Verified |
| 44 | `GET` | `/v1/conversations` | `ConversationsController` | Bearer JWT | Authenticated | User Conversations | Verified |
| 45 | `GET` | `/v1/conversations/:id` | `ConversationsController` | Bearer JWT | Authenticated | Conversation Participant | Verified |
| 46 | `GET` | `/v1/conversations/:id/messages` | `ConversationsController` | Bearer JWT | Authenticated | Conversation Participant | Verified |
| 47 | `POST` | `/v1/conversations/:id/messages` | `ConversationsController` | Bearer JWT | Authenticated | Conversation Participant | Verified |
| **12. WebRTC Voice (PTT) & Video Sessions** | | | | | | | |
| 48 | `POST` | `/v1/voice-sessions` | `CommunicationController` | Bearer JWT | OWNER | Assigned Driver Scope | Verified |
| 49 | `POST` | `/v1/video-sessions` | `CommunicationController` | Bearer JWT | OWNER | Assigned Driver Scope | Verified |
| 50 | `POST` | `/v1/realtime/sessions/:id/respond` | `CommunicationController` | Bearer JWT | DRIVER | Driver Consent Gate | Verified |
| 51 | `POST` | `/v1/realtime/sessions/:id/end` | `CommunicationController` | Bearer JWT | Authenticated | Session Participant | Verified |
| **13. Offline Sync & Conflict Resolution** | | | | | | | |
| 52 | `POST` | `/v1/me/sync/outbox` | `ConflictsController` | Bearer JWT | DRIVER | Driver Outbox Scope | Verified |
| 53 | `GET` | `/v1/conflicts` | `ConflictsController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER | Company Scope | Verified |
| 54 | `POST` | `/v1/conflicts/:id/resolve` | `ConflictsController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER | Authority Matrix Scope | Verified |
| **14. Push Notifications & Push Token** | | | | | | | |
| 55 | `POST` | `/v1/devices/register-push-token` | `NotificationController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER, DRIVER | Device Push Scope | Verified |
| 56 | `GET` | `/v1/notifications` | `NotificationController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER, DRIVER | User Notifications | Verified |
| 57 | `PATCH` | `/v1/notifications/:id/read` | `NotificationController` | Bearer JWT | ADMIN, SUPER_ADMIN, OWNER, DRIVER | User Notification | Verified |
| **15. Health & Observability** | | | | | | | |
| 58 | `GET` | `/v1/health/liveness` | `HealthController` | Public | Public | System Liveness | Verified |
| 59 | `GET` | `/v1/health/readiness` | `HealthController` | Public | Public | Deep Readiness Check | Verified |

---

## 3. Discrepancy Correction Log (Audit Fixes)

1. **Stops Controller Prefixes:** Corrected from `/v1/stops/:id/...` to runtime path `/v1/me/stops/:id/...` (Matches `StopsController` `@Controller('me/stops')`).
2. **E2EE Key Management Prefixes:** Corrected from `/v1/keys/...` to runtime path `/v1/e2ee/keys/...` (Matches `E2eeKeysController` `@Controller('e2ee/keys')`).
3. **Routes Domain Prefixes:** Corrected from `/v1/routes/...` to runtime path `/v1/deliveries/:id/routes/...` (Matches `RoutesController` `@Controller('deliveries/:id/routes')`).
4. **Emergency REST Endpoint:** Clarified that emergency SOS is triggered via WebSocket / high-priority alert pipeline and monitored via `fleet:monitoring` real-time events.
5. **Geocoding Endpoint Reference:** Clarified that geocoding rate-limit tier applies to backend routing adapters (`OsrmRoutingProvider` / `HaversineRoutingProvider`) and location validation services.

---

## 4. Documentation Hierarchy & Source of Truth
1. `docs/distribution-system-docs/API-ENDPOINTS.md` $\rightarrow$ Canonical REST Endpoint Index & Manual Testing Guide
2. `docs/distribution-system-docs/openapi/openapi.yaml` $\rightarrow$ Machine-Readable OpenAPI 3.0 Contract
3. `docs/distribution-system-docs/api/*` $\rightarrow$ Domain-Specific Detailed Specifications
4. `docs/distribution-system-docs/06-API-REALTIME.md` $\rightarrow$ WebSocket & Media Realtime Contract
5. **Runtime NestJS Codebase (`src/`)** $\rightarrow$ Absolute Final Source of Truth
