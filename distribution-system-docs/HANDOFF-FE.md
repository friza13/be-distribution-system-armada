# Frontend Handoff & Technical Integration Guide

**Document Version:** 2.0.0 (Audited Runtime Source of Truth)  
**Milestone:** Phase 18 Final API Documentation & Handoff Gate  
**Date:** 2026-09-03  
**Target Audience:** Frontend Engineering Team (Admin Web SPA, Owner Mobile Flutter, Driver Mobile Flutter)  
**Repository Commit Audited:** `840dfd6` (Runtime Source of Truth)

---

# FE API NOTICE

### IMPORTANT GOVERNANCE & INTEGRATION RULES FOR FRONTEND DEVELOPERS

#### DO
- **Canonical API Reference:** Always use [`distribution-system-docs/API-ENDPOINTS.md`](API-ENDPOINTS.md) as the primary index for REST endpoints, HTTP methods, paths, and status codes.
- **Correct Path Prefixes:** Note exact runtime paths:
  - Driver stop actions: `/v1/me/stops/:id/depart`, `/v1/me/stops/:id/arrive`, `/v1/me/stops/:id/unload`, `/v1/me/stops/:id/fail`, `/v1/me/stops/:id/pod`
  - Delivery routes: `/v1/deliveries/:id/routes/recommend`, `/v1/deliveries/:id/routes/select`, `/v1/deliveries/:id/routes/reorder`
  - E2EE Keys: `/v1/e2ee/keys/register`, `/v1/e2ee/keys/prekeys`, `/v1/e2ee/keys/bundle/:deviceId`
- **Dual Transport Authentication:**
  - **Admin Web:** Store Access Token in-memory. Handle `dms_csrf_token` cookie by setting `x-csrf-token` header on all mutation requests (`POST`, `PATCH`, `DELETE`, `PUT`).
  - **Mobile Apps (Owner & Driver):** Store Access Token and Refresh Token in secure hardware storage (Flutter Secure Storage). Attach `Authorization: Bearer <access_token>` header on all requests.
- **Server Authority & Anti-IDOR:** Respect server-enforced role access and object ownership. Always expect `403 Forbidden` (`code: RESOURCE_FORBIDDEN`) if attempting cross-driver or cross-tenant data requests.
- **Error Envelope Handling:** Parse errors using the standardized JSON shape: `{ success: false, error: { code, message, requestId } }`.
- **Idempotency Keys:** Include header `Idempotency-Key: <UUIDv4>` for critical state mutations (`/v1/deliveries/:id/complete`, `/v1/me/stops/:id/pod`, `/v1/me/sync/outbox`).

#### DON'T
- **No Undocumented Endpoints:** Do not invent or call unlisted endpoints.
- **No Hardcoded Secrets:** Never embed JWT signing keys, TURN HMAC secrets, or database credentials in client code.
- **No UI-Only Security Assumptions:** Hiding a button in UI does not mean security is complete. Backend strictly enforces authorization; always handle `403` gracefully.
- **No Plaintext E2EE Exposure:** Never transmit plaintext chat messages or private key material to REST or WebSocket endpoints.
- **No Reliance on Mobile Runtime Guarantees in Backend Tests:** Backend unit/E2E tests prove API ingestion and logic, NOT device OS background execution or push notification delivery. Mobile teams must handle background location services and push wake-ups per platform policies.

---

**Verified against Backend Commit:** `840dfd6`  
**Verification Date:** 2026-09-03  
**Known Limitations:**
- Mobile background location execution depends on Android Foreground Service / iOS Core Location background capabilities implemented on Flutter client side.
- Real FCM/APNs push delivery and WebRTC cellular NAT traversal require physical device testing with production certificates/TURN servers.

---

## 1. Backend Overview & Architectural Division

The backend is constructed as a **Modular Monolith in NestJS 10 (TypeScript)** with PostgreSQL 16 + PostGIS 3.4 and Redis 7.

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ CLIENT SURFACES                                                                        │
│ ┌───────────────────────┐   ┌───────────────────────┐   ┌────────────────────────────┐ │
│ │ Owner Mobile (Flutter)│   │ Driver Mobile(Flutter)│   │ Admin Web (Browser SPA)    │ │
│ └───────────┬───────────┘   └───────────┬───────────┘   └─────────────┬──────────────┘ │
└─────────────│───────────────────────────│─────────────────────────────│────────────────┘
              │ (Bearer JWT + WSS)        │ (Bearer JWT + WSS)          │ (HttpOnly Cookie + CSRF)
┌─────────────▼───────────────────────────▼─────────────────────────────▼────────────────┐
│ BACKEND API & REALTIME GATEWAY (Modular Monolith NestJS 10)                            │
│ ├── Auth / Session (Argon2id + JWS HS256 + Token Family Rotation)                      │
│ ├── RBAC & Object-Level Authorization (Anti-IDOR Engine)                               │
│ ├── Delivery & Stop State Machine + Transactional Outbox                               │
│ ├── Routing (2-Opt TSP Heuristic + OSRM Adapter) & GPS Ingestion (Haversine Filter)   │
│ ├── Socket.IO Realtime Gateway (/realtime) + Redis Revocation Bridge                   │
│ ├── E2EE Signal Protocol Chat Relay + WebRTC PTT/Video Signaling (RFC 7635 TURN)       │
│ └── Private POD Storage & Terminus Health Observability                                │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. API Integration Summary by Domain

Refer to [`distribution-system-docs/API-ENDPOINTS.md`](API-ENDPOINTS.md) for full specifications:
- **Auth:** `POST /v1/auth/login`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `GET /v1/auth/csrf`
- **Deliveries:** `POST /v1/deliveries`, `GET /v1/deliveries/:id`, `POST /v1/deliveries/:id/assign`, `POST /v1/deliveries/:id/accept`, `POST /v1/deliveries/:id/start`, `POST /v1/deliveries/:id/complete`
- **Stops:** `POST /v1/me/stops/:id/depart`, `POST /v1/me/stops/:id/arrive`, `POST /v1/me/stops/:id/unload`, `POST /v1/me/stops/:id/fail`, `POST /v1/me/stops/:id/skip`
- **Routes:** `POST /v1/deliveries/:id/routes/recommend`, `POST /v1/deliveries/:id/routes/select`, `PATCH /v1/deliveries/:id/routes/reorder`, `GET /v1/deliveries/:id/routes/current`
- **Keys:** `POST /v1/e2ee/keys/register`, `POST /v1/e2ee/keys/prekeys`, `GET /v1/e2ee/keys/bundle/:deviceId`
- **Telemetry:** `POST /v1/me/location`, `POST /v1/me/location/batch`
- **Fleet:** `GET /v1/fleet/locations`, `GET /v1/drivers/:id/location-history`
- **POD & Files:** `POST /v1/files/upload`, `GET /v1/files/:id/download`, `POST /v1/me/stops/:id/pod`
- **Chat:** `POST /v1/conversations`, `GET /v1/conversations/:id/messages`, `POST /v1/conversations/:id/messages`
- **Voice/Video:** `POST /v1/voice-sessions`, `POST /v1/video-sessions`, `POST /v1/realtime/sessions/:id/respond`
- **Notifications:** `POST /v1/devices/register-push-token`, `GET /v1/notifications`, `PATCH /v1/notifications/:id/read`
