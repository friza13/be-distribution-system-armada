# Technology Stack & Infrastructure

## 1. Purpose

Dokumen ini mendefinisikan baseline teknologi, opsi yang sedang dievaluasi, constraint infrastruktur, dan kriteria keputusan untuk sistem Distribution Management System.

## 2. Technology Stack Baseline

```text
Mobile Owner        : Flutter
Mobile Driver       : Flutter
Admin Web           : Web frontend
Backend             : TypeScript + Node.js LTS + NestJS
Database            : PostgreSQL + PostGIS
Cache / PubSub      : Redis
API                 : REST/JSON
Business Realtime   : WebSocket
Voice / Video       : WebRTC
Push Wake-up        : FCM / APNs (platform-dependent)
Edge                : Cloudflare
Container           : Docker
OS                  : Linux LTS
Object Storage      : S3-compatible / evaluated provider
```

ORM remains a decision to be evaluated against transaction, migration, query complexity, performance, type-safety, and team maintainability requirements.

## 3. Backend Security Technology Baseline

```text
Authentication      : JWT + revocable refresh/session strategy
Authorization       : RBAC + object-level authorization
Validation          : strict schema/DTO validation
Rate limiting       : application + edge controls where available
CORS                : explicit origin allowlist
DB access           : ORM / parameterized queries
TLS                 : HTTPS/WSS + origin TLS
Logging             : structured + sanitized
Audit               : append-oriented audit/security events
Secrets             : environment / secret injection
Dependency policy   : maintained stable/LTS releases + lockfile + scanning
```

Sensitive communication must not be treated as private merely because HTTP/TLS exists; chat requires endpoint/application-level encryption, while WebRTC media uses authenticated encrypted transport and an additional E2EE media strategy if relay confidentiality is required.

## 4. Mapping, Geocoding, and Routing

### 4.1 Separate responsibilities

```text
Map rendering
    ↓
Mobile/Web map library

Address search
    ↓
Geocoding provider

Road routing
    ↓
Routing engine

Stop-order optimization
    ↓
Backend business algorithm
```

### 4.2 Preferred cost-aware direction

- Base map data: OpenStreetMap-based.
- Web rendering: Leaflet or equivalent.
- Mobile: Flutter-compatible OSM-capable map library.
- Geocoding: provider abstraction; Nominatim may be used only within published policy and low-volume constraints; alternatives/self-hosting remain possible.
- Routing: OSRM, openrouteservice, or another evaluated provider.
- Google Maps Platform: valid alternative when coverage, reliability, SDK capability, traffic/ETA quality, or total operational cost justify it.

### 4.3 Routing responsibility

The routing engine calculates travel paths, matrices, and related road-network costs. Backend business logic selects the permitted/recommended stop order.

### 4.4 Routing complexity boundary

```text
n <= 5 stops
→ exhaustive permutation allowed as simple baseline

n > 5 stops
→ MUST NOT enumerate n! candidates in the synchronous main path
→ use Nearest Neighbor + 2-Opt, trip/optimization engine capability,
  or asynchronous optimization worker
```

For `n = 10`, exhaustive enumeration is 3,628,800 permutations; therefore it is not an acceptable default main-request algorithm.

### 4.5 Geocoding policy

Geocoding requests must be user-triggered or otherwise controlled, cached where appropriate, rate-limited, and monitored. Public Nominatim must not be treated as an unlimited autocomplete or high-volume vehicle-tracking backend. Evaluate a dedicated/self-hosted provider if workload exceeds public policy.

## 5. GPS / Mobile Location

The Driver smartphone is the authoritative device source for baseline location; there is no vehicle IoT/GPS tracker requirement.

```text
Driver phone
  ↓
Platform location APIs
  ↓
Client filtering/outbox
  ↓
Authenticated backend ingestion
  ↓
PostGIS latest/history
  ↓
Owner realtime map
```

### 5.1 Android

Active delivery tracking must use platform-approved mechanisms appropriate to the target Android version, including a location foreground service when required. The implementation must declare required foreground-service permissions/types and display the required notification.

The app must start such a service from an allowed lifecycle/context and cannot assume background service start is unrestricted on modern Android.

### 5.2 iOS

Use Core Location background capability and the authorization level required by the product. Prefer least-privilege staged authorization. Handle suspension/termination and recreate location service state according to platform rules.

### 5.3 GPS integrity

Treat client location as untrusted input. Validate:

- latitude/longitude bounds;
- client timestamp freshness;
- future timestamps;
- duplicate points;
- impossible jumps/speed;
- poor accuracy;
- driver/delivery authorization;
- server receive time.

## 6. Mobile Wake-Up / Push

WebSocket is the primary realtime channel while the app is connected. It is not a durable wake-up mechanism when the OS has suspended, terminated, or disconnected the application.

### 6.1 Provider baseline

```text
Android : Firebase Cloud Messaging (FCM)
iOS     : Apple Push Notification service (APNs)
VoIP-capable calls on iOS : PushKit/VoIP architecture only where justified
```

Push messages are used to notify/wake the app according to platform policy; server state remains authoritative.

### 6.2 Call request flow

```text
Owner starts PTT/video
        ↓
Backend auth + authorization
        ↓
Driver socket online?
   ┌────────┴─────────┐
  YES                 NO
   ↓                   ↓
WSS signaling      FCM/APNs wake-up
   ↓                   ↓
Driver reconnects / presents call UI
            ↓
        Session acceptance
```

A push must not contain unnecessary sensitive data. The app must tolerate missed pushes by keeping pending-call state on the backend.

## 7. Realtime & Media

### 7.1 Business realtime

Use authenticated WebSocket for:

- live driver location;
- driver status;
- delivery events;
- route changes;
- chat delivery state;
- notifications.

### 7.2 Voice / PTT / Video

Use WebRTC for media. Backend manages authorization, session creation, signaling, expiry, and audit metadata; media does not travel through ordinary REST endpoints.

### 7.3 Cloudflare boundary

```text
api.domain
  ↓
Cloudflare Proxy
  ↓
HTTPS / NestJS

ws.domain
  ↓
Cloudflare Proxy
  ↓
WSS / Realtime

turn.domain
  ↓
DNS-only or separately validated L4 path
  ↓
TURN/STUN
```

Ordinary Cloudflare HTTP/HTTPS proxying is not a generic UDP relay. If a Cloudflare L4/Spectrum capability is ever selected, validate plan, ports, protocol, and architecture explicitly rather than assuming ordinary orange-cloud proxying is sufficient.

## 8. Storage Strategy

- transactional data → PostgreSQL/PostGIS;
- cache/presence/pubsub → Redis;
- POD/media objects → private object storage;
- do not place large video objects in the application container filesystem;
- use temporary/signed access for authorized downloads where supported;
- encrypt backups and protect object-storage credentials.

## 9. PostGIS Spatial Storage

Canonical database design:

```sql
geom geometry(Point, 4326)
```

Recommended index:

```sql
CREATE INDEX idx_location_points_geom
ON location_points
USING GIST (geom);
```

Spatial queries should use the geometry column and PostGIS operators/functions rather than repeatedly performing manual Haversine calculations over unindexed coordinate columns.

Latitude/longitude can remain as API fields or generated/convenience values, but `geom` is the spatial query source of truth.

## 10. Offline / Conflict Strategy

Baseline:

```text
Driver local outbox
      ↓
Idempotency key + client event time
      ↓
Server current-state check
      ↓
Server-authoritative state
      ↓
Conflict → evidence-preserving exception review
```

Never silently discard Driver POD/evidence merely because a later state exists.

## 11. VPS Specification

### 11.1 Development

```text
Local developer PC
Docker Compose
PostgreSQL
Redis
NestJS
Optional local routing service
```

### 11.2 Capstone Demo / Staging

```text
2 vCPU
2 GB RAM
30 GB SSD/NVMe
Linux LTS
Docker
```

Recommended services on this profile:

```text
NestJS
PostgreSQL/PostGIS
Redis
Reverse proxy
```

Avoid co-locating self-hosted OSRM datasets, TURN, or heavy media infrastructure unless measured and approved.

### 11.3 More comfortable

```text
2–4 vCPU
4 GB RAM
40–60 GB SSD/NVMe
```

### 11.4 Self-hosted OSRM / TURN

Resource needs must be measured with the actual geographic dataset and expected connections. A 2 GB VPS must not be treated as sufficient by assumption.

## 12. Environment & `.env` Policy

Recommended configuration keys:

```text
NODE_ENV
PORT
DATABASE_URL
REDIS_URL
JWT_ACCESS_SIGNING_KEY_REF
JWT_REFRESH_SECRET_REF
ENCRYPTION_KEY_REF
CORS_ALLOWED_ORIGINS
RATE_LIMIT_*
CLOUDFLARE_ORIGIN_CONFIG
TURN_*
FCM_*
APNS_*
STORAGE_*
MAP_*
GEOCODING_*
ROUTING_*
LOG_LEVEL
AUDIT_LOG_RETENTION
LOCATION_RETENTION
```

Rules:

- commit `.env.example`, never real production secrets;
- inject environment-specific secrets through deployment/secret management;
- never expose backend secrets to mobile/web clients;
- rotate/revoke secrets when compromise is suspected;
- log secret references/IDs only where needed, never secret values.

## 13. Cost-Aware Decision Matrix

| Decision | Preferred initial direction | Alternative | Status |
|---|---|---|---|
| Map data | OpenStreetMap-based | Google Maps | Evaluation |
| Web renderer | Leaflet | Google Maps JS SDK | Evaluation |
| Mobile map | OSM-compatible Flutter library | Google Maps Flutter | Evaluation |
| Geocoding | Provider abstraction | Nominatim / Geoapify / LocationIQ / self-host | Evaluation |
| Routing | OSRM / OSM-based engine | openrouteservice / Google Routes | Evaluation |
| Optimization | Backend heuristic after routing costs | managed optimization API | Evaluation |
| ORM | Evaluate Prisma / Drizzle / TypeORM | — | TBD |
| Push | FCM + APNs | other managed push | Baseline |
| TURN | External/managed for small demo | self-host Coturn | Evaluation |
| VPS | 2 vCPU / 2 GB / 30 GB staging | 4 GB+ | Recommendation |

## 14. Technology Decision Record Rules

Every material technology decision must record:

- decision;
- alternatives considered;
- reason;
- measurable criteria;
- security impact;
- cost impact;
- operational impact;
- test/benchmark evidence;
- date;
- owner.

## 15. Current Status

### Confirmed / baseline

- Flutter Owner/Driver mobile clients;
- Admin Web;
- TypeScript + Node.js LTS + NestJS recommended backend;
- PostgreSQL/PostGIS;
- Redis;
- Docker/Linux LTS;
- Cloudflare for supported web traffic;
- HTTPS/WSS mandatory;
- JWT + RBAC + object authorization;
- structured/sanitized logging and audit logging;
- WebSocket for business realtime;
- WebRTC for media;
- FCM/APNs push integration contract;
- Driver smartphone as GPS source;
- PostGIS `geometry(Point, 4326)` + spatial indexing baseline.

### Evaluation / TBD

- final ORM;
- map provider/tile strategy;
- geocoder provider;
- routing provider;
- hosted vs self-hosted OSRM;
- PTT/video media topology;
- true E2EE implementation/library;
- final VPS provider/size;
- managed vs self-hosted TURN.

## 16. Validation Checklist

Before sprint lock:

1. Verify map coverage and licensing/usage policy.
2. Benchmark geocoding with cache and rate limiting.
3. Benchmark routing with representative stop counts.
4. Verify `n <= 5` exhaustive baseline and `n > 5` heuristic/engine path.
5. Verify PostGIS geometry creation and GiST queries.
6. Test Android background tracking.
7. Test iOS background tracking.
8. Test push wake-up when WebSocket is unavailable.
9. Test TURN path separately from Cloudflare HTTP proxy.
10. Measure VPS CPU/RAM/disk/network usage.
11. Evaluate dependency security and LTS/support status at implementation time.
12. Record all final choices in decision logs.

## 17. Graceful Degradation Rules

Core delivery operation must not depend on optional realtime media.

```text
Video unavailable → chat / operational delivery still works
Voice unavailable → chat still works
Push missed → pending server-side session remains queryable
Routing provider unavailable → manual route mode remains available
Geocoder unavailable → allow manual coordinate/address confirmation path where product permits
Internet temporarily unavailable → driver outbox preserves critical commands
```

## 18. References for Platform Constraints

The implementation team should validate platform/provider rules against the current official documentation before release because platform permissions, service limits, and provider pricing can change.
