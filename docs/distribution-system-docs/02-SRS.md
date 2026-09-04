# Software Requirements Specification (SRS)

**System:** Distribution Management System  
**Version:** 1.1  
**Date:** 2026-08-30

## 1. System context

The system consists of one backend and three client surfaces:

- Owner Mobile
- Driver Mobile
- Admin Web

There is no customer application.

## 2. Actors

| Actor | Description |
|---|---|
| Admin | Highest-trust system administrator |
| Owner | Operational manager/distribution owner |
| Driver | Field delivery executor |
| Maps/Route Provider | External map/routing service if selected |
| Push Provider | Mobile notification provider |
| Media Infrastructure | STUN/TURN/SFU/WebRTC infrastructure as selected |

## 3. Functional requirements

### FR-AUTH — Authentication

- FR-AUTH-01: System shall authenticate users using secure credential flow.
- FR-AUTH-02: Sessions shall be attributable to user and device where applicable.
- FR-AUTH-03: Account states shall include `PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED`, `DISABLED`.
- FR-AUTH-04: Initial Admin shall be created through secure bootstrap.
- FR-AUTH-05: Passwords shall never be stored plaintext.
- FR-AUTH-06: Production authentication shall use short-lived access tokens with refresh-token lifecycle controls.
- FR-AUTH-07: Logout/revocation shall invalidate applicable refresh/session material.

### FR-RBAC — Authorization

- FR-RBAC-01: Authorization shall be enforced server-side.
- FR-RBAC-02: Admin may manage Owner and Driver.
- FR-RBAC-03: Owner may manage Driver only within permitted operational scope.
- FR-RBAC-04: Driver may access only authorized self/assigned resources.
- FR-RBAC-05: Object-level authorization shall protect resource IDs from IDOR.
- FR-RBAC-06: UI hiding shall never be treated as an authorization control.

### FR-USER

- FR-USER-01: Admin can create Owner.
- FR-USER-02: Admin can create Driver.
- FR-USER-03: Owner may create Driver if permission enabled.
- FR-USER-04: Creator identity shall be audited.
- FR-USER-05: Owner shall not create/elevate Admin.

### FR-DEL

- FR-DEL-01: Owner can create delivery.
- FR-DEL-02: Delivery contains items.
- FR-DEL-03: Delivery contains destination stops.
- FR-DEL-04: Delivery can be assigned to an active Driver and optionally a Vehicle.
- FR-DEL-05: Delivery state transitions shall follow the state machine.
- FR-DEL-06: Failed delivery shall require a reason/code or note.

### FR-ROUTE

- FR-ROUTE-01: Owner can define stop order manually.
- FR-ROUTE-02: Driver can select permitted stop order.
- FR-ROUTE-03: System shall support recommended/automatic route calculation.
- FR-ROUTE-04: Routing engine may calculate travel distance/duration/matrix.
- FR-ROUTE-05: Backend shall apply route-selection business logic/optimization.
- FR-ROUTE-06: Route provider shall be replaceable through an integration boundary.
- FR-ROUTE-07: Routing requests shall not occur for every GPS ping.
- FR-ROUTE-08: Navigation may hand off to an external navigation application in MVP.

### FR-TRACK

- FR-TRACK-01: Driver app shall collect location only while permitted and tracking is active.
- FR-TRACK-02: Payload should include latitude, longitude, accuracy, timestamp, speed where available, heading where available.
- FR-TRACK-03: Backend shall reject stale/invalid/outlier locations.
- FR-TRACK-04: Location history shall follow retention policy.
- FR-TRACK-05: Owner can view latest valid location and trip history.
- FR-TRACK-06: Driver cannot view unrestricted fleet location.
- FR-TRACK-07: Reporting frequency shall be adaptive to reduce battery use.
- FR-TRACK-08: Server receive time shall be recorded separately from device recorded time.

### FR-GEOFENCE

- FR-GEOFENCE-01: Stop may define operational radius.
- FR-GEOFENCE-02: System may infer arrival/departure.
- FR-GEOFENCE-03: Automatic state transition may require driver confirmation.

### FR-COMM — Communication

- FR-COMM-01: Owner and Driver shall support text chat.
- FR-COMM-02: Owner can initiate push-to-talk.
- FR-COMM-03: Driver can participate in authorized voice session.
- FR-COMM-04: Owner can request live video.
- FR-COMM-05: Driver must explicitly accept video request.
- FR-COMM-06: Basic delivery completion shall remain available if media services are unavailable.
- FR-COMM-07: Private chat shall support application-level E2EE using an established secure messaging design.
- FR-COMM-08: Voice/video shall use WebRTC transport security and an explicit media E2EE strategy where architecture requires protection from relay/SFU plaintext access.
- FR-COMM-09: Signaling shall be authenticated and authorized.
- FR-COMM-10: Backend logs shall not contain plaintext message/media content.

### FR-POD

- FR-POD-01: Driver can upload photo(s).
- FR-POD-02: Driver can capture receiver name.
- FR-POD-03: Driver can capture signature where applicable.
- FR-POD-04: Driver can add note.
- FR-POD-05: POD shall be associated with stop and delivery.
- FR-POD-06: File uploads shall validate type/size and use controlled storage.

### FR-NOTIF

- FR-NOTIF-01: Owner receives important driver/delivery events.
- FR-NOTIF-02: Driver receives assignment, route, chat, and operational notifications.
- FR-NOTIF-03: Emergency notifications are high priority.

### FR-EMG

- FR-EMG-01: Driver can trigger SOS.
- FR-EMG-02: SOS should include latest known location, driver, vehicle, timestamp.
- FR-EMG-03: Owner/Admin can view active emergency.
- FR-EMG-04: Emergency event shall be audited.

### FR-AUDIT

- FR-AUDIT-01: Sensitive operations shall be audited.
- FR-AUDIT-02: Audit record shall contain actor, action, entity, entity ID, timestamp, result.
- FR-AUDIT-03: Audit log shall be append-oriented and protected from ordinary user modification.

### FR-LOG

- FR-LOG-01: Application shall produce structured application/error/security logs.
- FR-LOG-02: Logs shall have request/correlation ID where applicable.
- FR-LOG-03: Logs shall redact passwords, access/refresh tokens, signing keys, encryption keys, secrets, plaintext E2EE content, and sensitive media.
- FR-LOG-04: Log injection shall be prevented through structured logging and sanitization.

## 4. Non-functional requirements

### NFR-PERF

- NFR-PERF-01: Normal API operations should be low latency under expected load.
- NFR-PERF-02: Realtime location fan-out shall be separated from heavy transactional work where practical.
- NFR-PERF-03: Route calculation shall not run on every location update.
- NFR-PERF-04: Performance targets shall be validated through load testing rather than assumed.

### NFR-SEC

- NFR-SEC-01: Production network communication shall use HTTPS/WSS.
- NFR-SEC-02: Authentication shall use signed tokens with secure key management.
- NFR-SEC-03: Secrets shall be provided through environment/secret management and never committed.
- NFR-SEC-04: CORS shall use explicit allowlists for authenticated clients.
- NFR-SEC-05: Rate limiting shall protect authentication and sensitive endpoints.
- NFR-SEC-06: API inputs shall use strict schema validation.
- NFR-SEC-07: Database access shall use parameterized queries/ORM; raw SQL shall be controlled.
- NFR-SEC-08: Security headers shall be configured for web surfaces.
- NFR-SEC-09: Object-level authorization shall be tested.
- NFR-SEC-10: Sensitive data at rest shall use appropriate encryption/key management.
- NFR-SEC-11: Private communication shall have endpoint/application-level protection beyond ordinary server-side TLS.
- NFR-SEC-12: Dependency versions shall be supported and security-reviewed before release.

### NFR-REL

- NFR-REL-01: Media outage shall not corrupt delivery state.
- NFR-REL-02: Driver app should queue critical events during temporary offline periods.
- NFR-REL-03: Critical event submission shall use idempotency keys where duplicates are possible.
- NFR-REL-04: Database backup and restore procedures shall be tested.

### NFR-MOBILE

- NFR-MOBILE-01: Background location shall comply with platform permission/policy.
- NFR-MOBILE-02: Tracking status shall be visible to Driver.
- NFR-MOBILE-03: Battery use shall be evaluated under field conditions.
- NFR-MOBILE-04: Camera/microphone/location permissions shall follow least privilege.

### NFR-INFRA

- NFR-INFRA-01: Local development shall be reproducible with documented tooling/containerization where practical.
- NFR-INFRA-02: Staging/demo environment shall be separated from production secrets.
- NFR-INFRA-03: Reverse proxy/edge shall support HTTPS/WSS and security controls.
- NFR-INFRA-04: Production-like deployment shall support health checks, logs, and backups.

### NFR-SCALE

- NFR-SCALE-01: API, realtime, location ingestion, route workers, and media infrastructure shall have separable scaling boundaries.
- NFR-SCALE-02: Redis shall not be the only source of transactional business truth.

## 5. Technology constraints

- Flutter mobile apps.
- Admin Web.
- TypeScript/Node.js/NestJS recommended backend baseline.
- PostgreSQL recommended database.
- Redis for appropriate cache/pubsub.
- Docker/Linux LTS.
- Cloudflare at edge.
- OSM-based mapping preferred for cost evaluation.
- Routing provider/ORM remain replaceable until evaluated.

## 6. Security/data constraints

- No custom cryptographic algorithm.
- SHA-256/SHA-512 are hashing primitives, not message encryption.
- AES-256-GCM or ChaCha20-Poly1305 may be used where an application-level AEAD primitive is genuinely required.
- E2EE chat should use an established secure messaging protocol rather than a homegrown protocol.
- WebRTC media security must be configured using standard WebRTC mechanisms; if SFU is introduced and relay confidentiality is required, evaluate E2EE media/SFrame.

## 7. Acceptance baseline

A baseline release is acceptable when:

1. Admin can provision Owner/Driver securely.
2. Owner can create/assign delivery.
3. Driver can execute delivery.
4. Driver GPS reaches backend.
5. Owner can view authorized live/latest location.
6. Driver can submit POD.
7. Critical actions are authorization-protected and audited.
8. HTTPS/WSS, CORS, rate limiting, schema validation, parameterized DB access, and sanitized logging are active.
9. Communication security acceptance tests pass for the implemented scope.

## 8. Additional security requirements

### FR-SESSION — Device and Session Management

- FR-SESSION-01: Sistem shall maintain identifiable user/device sessions for protected clients.
- FR-SESSION-02: User/Admin shall be able to revoke authorized sessions according to role.
- FR-SESSION-03: Disabled/suspended accounts shall lose access to new authenticated sessions and active realtime channels within the defined revocation window.
- FR-SESSION-04: Refresh-token reuse or equivalent session compromise signals shall trigger session protection/revocation policy.

### FR-UPLOAD — Secure File Upload

- FR-UPLOAD-01: Uploads shall validate size, type, MIME/extension consistency, and filename/path safety.
- FR-UPLOAD-02: Files shall not be publicly addressable by default.
- FR-UPLOAD-03: File download shall enforce resource-level authorization.
- FR-UPLOAD-04: File metadata shall include integrity information where appropriate.

### FR-RTSEC — Realtime Security

- FR-RTSEC-01: WebSocket connections shall authenticate and authorize subscriptions/actions.
- FR-RTSEC-02: Realtime commands shall enforce resource ownership/scope.
- FR-RTSEC-03: Sensitive realtime commands shall implement replay/duplicate protection.
- FR-RTSEC-04: WebRTC signaling messages shall be authenticated, validated, authorized, size-limited, and bound to a valid session.

### FR-E2EE — Private Communication

- FR-E2EE-01: Chat plaintext shall be encrypted at the endpoint before backend transmission.
- FR-E2EE-02: Backend shall not require chat plaintext to perform normal message relay/storage.
- FR-E2EE-03: Endpoint identity/key lifecycle shall support key verification/rotation/revocation according to the selected protocol.
- FR-E2EE-04: If an SFU is introduced and relay confidentiality is required, evaluate E2EE media/SFrame rather than relying only on transport encryption.

### FR-GPSSEC — Location Integrity and Privacy

- FR-GPSSEC-01: Backend shall reject or flag stale, invalid, impossible, or suspicious location points.
- FR-GPSSEC-02: Backend shall distinguish latest valid location from untrusted/raw submissions.
- FR-GPSSEC-03: Location history shall follow retention and access policies.
- FR-GPSSEC-04: Tracking shall be limited to operational scope and permitted device state.

### FR-IDEMP — Idempotency and Replay Protection

- FR-IDEMP-01: Critical commands shall support idempotency keys or equivalent duplicate suppression.
- FR-IDEMP-02: Server-side state transitions shall be validated so replayed commands cannot bypass workflow state.

### FR-NOTIFSEC — Notification Privacy

- FR-NOTIFSEC-01: Push payloads shall minimize sensitive content.
- FR-NOTIFSEC-02: Lock-screen notifications shall not expose protected content unnecessarily.

## 9. Additional non-functional requirements

### NFR-SEC2

- NFR-SEC2-01: Backend authorization shall use object/resource-level checks.
- NFR-SEC2-02: Logs shall use structured fields and sanitization against log injection.
- NFR-SEC2-03: Secrets shall never be emitted to logs or client responses.
- NFR-SEC2-04: Dependency versions shall be pinned/lockfile-controlled and periodically vulnerability-scanned.
- NFR-SEC2-05: Security tests shall include same-Wi-Fi packet inspection, IDOR/BOLA, JWT/session abuse, upload abuse, WebSocket authorization, replay, and log leakage checks.




## 10. Additional Mobile, Network, Mapping, Conflict, and Resilience Requirements

### NFR-MOBILE-08 — Background GPS Execution

- Active delivery tracking shall use platform-approved background location mechanisms.
- Android shall use a location Foreground Service when required by the target Android version and shall satisfy the corresponding permission/type/notification requirements.
- iOS shall use the appropriate Core Location background capability and authorization flow for the product need.
- The application shall handle suspension, termination, app restart, phone lock, battery optimization, denied permissions, and network loss.
- The system shall not treat a Dart timer or WebSocket connection as a guarantee of continuous background execution.

### FR-PUSH — Mobile Wake-Up

- FR-PUSH-01: The backend shall maintain pending notification/call state independently of an individual WebSocket connection.
- FR-PUSH-02: The system shall integrate FCM for Android and APNs for iOS for operational push notification/wake-up flows.
- FR-PUSH-03: Owner-initiated PTT/video requests shall use WebSocket when Driver is connected and a platform push path when the socket is unavailable, subject to platform policy.
- FR-PUSH-04: iOS VoIP-capable push mechanisms shall only be used for valid VoIP/call use cases and shall follow Apple platform requirements.
- FR-PUSH-05: Push payloads shall minimize sensitive content.
- FR-PUSH-06: Missed push delivery shall not lose the authoritative pending session/request state.

### NFR-NET — Cloudflare and Media Boundary

- NFR-NET-01: Production REST and WebSocket traffic shall use HTTPS/WSS.
- NFR-NET-02: Ordinary Cloudflare HTTP/HTTPS proxying shall not be treated as a generic UDP relay.
- NFR-NET-03: TURN/STUN shall use a separately validated L4/UDP network path, commonly DNS-only/direct unless a compatible Cloudflare network product is explicitly configured and tested.
- NFR-NET-04: WebRTC media shall not depend on ordinary REST proxying.

### FR-MAP — Geocoding and Mapping

- FR-MAP-01: The system shall separate map rendering, geocoding, routing, and route optimization responsibilities.
- FR-MAP-02: Address text shall be converted to coordinates through a geocoding service before routing when coordinates are not supplied.
- FR-MAP-03: Geocoding providers shall be abstracted so that the provider can be changed without changing core domain logic.
- FR-MAP-04: Public geocoding services shall be used only within published usage limits and with caching/rate limiting where applicable.

### FR-ROUTE — Routing Complexity

- FR-ROUTE-06: Exhaustive permutation route evaluation may be used only for `<= 5` stops as a bounded baseline.
- FR-ROUTE-07: For `> 5` stops the system shall use a non-factorial approach such as Nearest Neighbor + 2-Opt, routing-engine trip/optimization capability, or an asynchronous optimization worker.
- FR-ROUTE-08: Route optimization shall not block the main API request path through uncontrolled factorial computation.

### NFR-GEO — PostGIS

- NFR-GEO-01: Spatially queried points shall use PostGIS geometry `geometry(Point, 4326)` as the canonical database spatial representation.
- NFR-GEO-02: Location/destination spatial tables shall use an appropriate GiST spatial index.
- NFR-GEO-03: Spatial queries shall prefer indexed PostGIS operations over repeated full-table manual distance calculations.

### FR-CONFLICT — Offline Conflict Resolution

- FR-CONFLICT-01: Server transactional state shall be authoritative.
- FR-CONFLICT-02: Offline commands shall include idempotency information and client event timestamps.
- FR-CONFLICT-03: A command that no longer matches the current state shall not silently overwrite it.
- FR-CONFLICT-04: Conflicts shall preserve evidence, including POD, and create an auditable exception for Owner/Admin review.

### NFR-TIME — Timestamp Integrity

- Client timestamps shall be treated as untrusted metadata.
- Server receive time shall be recorded for security-sensitive events.
- The backend shall detect unreasonable future/stale timestamps and excessive clock skew where relevant.

### NFR-RES — Graceful Degradation

- Video/voice failure shall not prevent delivery completion.
- Routing-provider failure shall preserve a manual route fallback where product rules allow.
- Temporary push failure shall not erase pending sessions.
- Temporary network loss shall preserve critical Driver commands using the outbox strategy.

## 11. Security and Operational Acceptance Additions

The system shall not be considered release-ready until the following are tested:

- same-Wi-Fi packet inspection;
- JWT/session revocation;
- IDOR/BOLA;
- WebSocket authorization;
- push wake-up behavior;
- background GPS behavior on supported Android/iOS targets;
- routing complexity boundary;
- PostGIS spatial index usage;
- offline conflict handling;
- secure file upload;
- log sanitization and secret leakage;
- dependency vulnerability checks.

