# Project Flow & Implementation Illustration

## 1. End-to-End System Flow

```mermaid
flowchart TB
  subgraph ADMIN[Admin Web]
    A1[Login]
    A2[Manage Owner/Driver]
    A3[Manage Vehicle]
    A4[Audit / System]
  end
  subgraph OWNER[Owner Mobile]
    O1[Dashboard]
    O2[Create Delivery]
    O3[Assign Driver/Vehicle]
    O4[Map & Tracking]
    O5[Route Management]
    O6[Chat / PTT / Video Request]
    O7[POD / Reports]
  end
  subgraph DRIVER[Driver Mobile]
    D1[Login / Activate]
    D2[Today's Delivery]
    D3[Route Selection]
    D4[GPS Tracking]
    D5[Navigation]
    D6[Delivery Execution]
    D7[POD]
    D8[Chat / Receive Voice / Video]
    D9[SOS]
  end
  subgraph BE[Backend]
    B1[Auth + RBAC + Sessions]
    B2[User / Device]
    B3[Delivery]
    B4[Route / Geocoding]
    B5[Tracking]
    B6[Realtime]
    B7[Communication]
    B8[POD / Storage]
    B9[Notification]
    B10[Audit / Security]
    B11[Conflict Resolution]
  end

  A1 --> B1
  A2 --> B2
  A3 --> B2
  A4 --> B10
  O1 --> B1
  O2 --> B3
  O3 --> B3
  O4 --> B5
  O5 --> B4
  O6 --> B7
  O7 --> B8
  D1 --> B1
  D2 --> B3
  D3 --> B4
  D4 --> B5
  D5 --> B4
  D6 --> B3
  D7 --> B8
  D8 --> B7
  D9 --> B10
  B3 --> B9
  B5 --> B6
  B7 --> B6
  B11 --> B10
  B6 --> O4
  B6 --> O6
  B6 --> D8
```

## 2. Daily Operating Flow

```mermaid
sequenceDiagram
  participant A as Admin
  participant O as Owner
  participant B as Backend
  participant P as Push Provider
  participant D as Driver

  A->>B: Provision accounts
  O->>B: Create delivery
  O->>B: Add items/destinations
  B->>B: Geocode/validate destinations
  O->>B: Assign driver/vehicle
  B-->>D: Delivery assigned notification
  D->>B: Accept delivery
  D->>B: Select route
  B-->>D: Confirm route
  D->>B: Start delivery
  loop During trip
    D->>B: GPS update
    B-->>O: location.updated
  end
  D->>B: Arrive stop
  D->>B: POD
  B-->>O: stop.completed
  D->>B: Complete delivery
  B-->>O: delivery.completed
```

## 3. Route Decision Flow

```mermaid
flowchart TD
  A[Delivery has stops] --> B{Route mode?}
  B -->|Manual| C[Driver/Owner picks order]
  B -->|Recommended| D[Backend calculates candidates]
  B -->|Automatic| D
  D --> E{Number of stops}
  E -->|<= 5| F[Exhaustive baseline]
  E -->|> 5| G[Nearest Neighbor + 2-Opt / Engine-assisted]
  F --> H[Selected route]
  G --> H
  C --> H
  H --> I{Override allowed?}
  I -->|Yes| J[Permitted alternate route]
  I -->|No| K[Route locked]
  J --> L[Navigation]
  K --> L
```

## 4. Communication Flow

```mermaid
sequenceDiagram
  participant O as Owner
  participant B as Backend
  participant P as FCM/APNs
  participant D as Driver
  participant M as WebRTC Media

  O->>B: Request PTT/video
  B->>B: Auth + object authorization
  alt Driver socket online
    B-->>D: WebSocket signaling
  else Socket unavailable
    B->>P: Platform push wake-up / VoIP notification
    P-->>D: Incoming request notification
    D->>B: Reconnect / accept
  end
  B-->>O: Session metadata
  B-->>D: Session metadata
  O<->>M: WebRTC encrypted media
  D<->>M: WebRTC encrypted media
```

## 5. Security Gates in Every Sensitive Operation

```text
Client Request
    ↓
TLS / WSS
    ↓
Authentication
    ↓
Schema Validation
    ↓
Rate Limit / Abuse Check
    ↓
Object Authorization
    ↓
Business-State Validation
    ↓
Idempotency / Replay Check
    ↓
Transaction
    ↓
Audit / Security Event
    ↓
Sanitized Realtime Notification
```

## 6. Offline Conflict Flow

```mermaid
flowchart TD
  A[Driver offline] --> B[Local Outbox]
  B --> C[Reconnect]
  C --> D[Backend reads current server state]
  D --> E{Command valid now?}
  E -->|Yes| F[Apply transaction]
  E -->|No| G[Create conflict / preserve evidence]
  G --> H[Owner/Admin review]
  H --> I[Resolution]
  F --> J[Audit]
  I --> J
```

## 7. Background GPS Flow

```mermaid
flowchart TD
  A[Active delivery] --> B[Platform location capability]
  B --> C[GPS sample]
  C --> D[Client filter / local queue]
  D --> E[Authenticated upload]
  E --> F[Server timestamp + validation]
  F --> G[Latest location + history]
  G --> H[Authorized realtime broadcast]
```

## 8. Mobile Wake-Up Flow

```text
Owner requests PTT/video
        ↓
Backend authorizes session
        ↓
Driver socket online?
   ┌────────┴─────────┐
  YES                 NO
   ↓                   ↓
WebSocket         FCM/APNs wake-up
   ↓                   ↓
Driver receives/reconnects
          ↓
     Session accepted
```

Wake-up pushes are platform mechanisms with restrictions; they are not a replacement for durable server state or a guarantee of arbitrary background execution.

## 9. Geocoding and Mapping Flow

```text
Owner enters address
       ↓
Geocoding abstraction
       ↓
Candidate coordinates
       ↓
Owner confirmation if ambiguous
       ↓
PostGIS geometry point
       ↓
Routing engine
       ↓
Route/matrix result
       ↓
Backend optimization
       ↓
Owner/Driver map
```

## 10. PostGIS Spatial Flow

```text
GPS coordinate
     ↓
geometry(Point, 4326)
     ↓
GiST spatial index
     ↓
geofence / nearest / bounding queries
```

## 11. Recommended Implementation Order

```text
1. Repository + Git checkpoint
2. Database + PostGIS migrations
3. Auth + RBAC + sessions/devices
4. Admin Web user management
5. Owner delivery management
6. Driver delivery execution
7. Vehicle assignment
8. Geocoding abstraction
9. GPS ingestion + validation
10. Owner live map
11. Route/manual navigation
12. Offline outbox + conflict handling
13. POD
14. Notifications + wake-up push
15. Route recommendation / optimization boundary
16. Chat
17. Push-to-talk
18. Video request
19. Security hardening
20. Testing + staging + release
```

## 12. Practical Team Split

### Backend / Security

```text
Auth / Sessions / Devices
Users / Roles
Drivers / Vehicles
Deliveries / Items / Stops
Geocoding / Routing integration
Tracking / Location validation
Messaging / E2EE integration
Realtime / WebSocket
WebRTC signaling
POD / Upload authorization
Notifications / Push wake-up contract
Audit / Security events
Conflict resolution
```

### Owner Mobile / Driver Mobile / Admin Web

See `10-TEAM-RESPONSIBILITY.md` for the detailed ownership matrix.

## 13. Infrastructure & Deployment Flow

```mermaid
flowchart LR
  DEV[Developer Workstation] --> CI[CI/CD]
  CI --> STG[Capstone Staging]
  STG --> QA[Integration / Field / Security QA]
  QA --> REL[Release Candidate]
  REL --> PROD[Production / Final Demo]
```

Staging should use the cost-aware VPS baseline and isolate heavy routing/media infrastructure unless resource testing proves safe.

## 14. Final Technical Flow

```text
Client
  ↓ HTTPS/WSS
Cloudflare / Reverse Proxy
  ↓
NestJS Auth + Validation + Rate Limit
  ↓
RBAC + Object Authorization
  ↓
Domain Service
  ↓
ORM / Parameterized DB Access
  ↓
PostgreSQL + PostGIS / Redis / Object Storage

Realtime media:
Client ↔ WebRTC ↔ Media Infrastructure
           ↑
    Backend signaling/auth
```
