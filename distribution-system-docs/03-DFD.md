# Data Flow Diagram (DFD) & Business Flow

## 1. Context / Level 0

```mermaid
flowchart LR
  A[Admin Web] -->|User/System commands| B((Distribution Backend))
  O[Owner Mobile] -->|Operational commands| B
  D[Driver Mobile] -->|Delivery + GPS + messages| B
  B -->|System dashboard/audit| A
  B -->|Fleet / delivery / realtime| O
  B -->|Tasks / route / notifications| D
  B <--> M[Maps / Geocoding / Routing Provider]
  B <--> R[WebSocket / WebRTC Infrastructure]
  B --> P[FCM / APNs Push Provider]
  B <--> S[Object Storage]
```

## 2. Level 1 — Core Processes

```mermaid
flowchart TB
  A[Admin] --> P1[1. Authentication & User Management]
  O[Owner] --> P2[2. Delivery & Dispatch]
  D[Driver] --> P3[3. Driver Execution]
  D --> P4[4. Location Tracking]
  O --> P5[5. Route & Mapping]
  D --> P5
  O --> P7[7. Communication]
  D --> P7
  P2 --> P6[6. Proof of Delivery]
  P3 --> P6

  P1 --> D1[(Users / Roles / Sessions / Devices)]
  P2 --> D2[(Deliveries / Items / Stops)]
  P3 --> D3[(Delivery Events / Conflicts)]
  P4 --> D4[(Latest Location / History)]
  P5 --> D5[(Routes / Route Plans / Geo Data)]
  P6 --> D6[(POD Metadata / File References)]
  P7 --> D7[(Conversation Metadata / Encrypted Payload)]
  P1 --> D8[(Audit Logs / Security Events)]
```

## 3. Level 2 — GPS Flow

```mermaid
flowchart LR
  A[Driver Smartphone GPS] --> B[Platform Location Service]
  B --> C[Client Filter / Queue]
  C --> D[Authenticated Location Request]
  D --> E[Schema / Auth / Integrity Validation]
  E -->|Invalid| F[Reject / Flag + Sanitized Log]
  E -->|Valid| G[Normalize + Server Receive Time]
  G --> H[Latest Valid Location]
  G --> I[Location History]
  H --> J[Authorized Realtime Broadcast]
  J --> K[Owner Map]
```

## 4. Level 2 — Delivery Creation and Route

```mermaid
flowchart TD
  A[Owner] --> B[Create Delivery]
  B --> C[Add Items]
  C --> D[Enter Destination Address]
  D --> E[Geocode Address]
  E --> F[Store Coordinates / Stop]
  F --> G[Assign Driver]
  G --> H[Assign Vehicle]
  H --> I{Route Mode}
  I -->|Manual| J[Store Selected Order]
  I -->|Recommended| K[Routing Matrix / Candidate Routes]
  I -->|Automatic| K
  K --> L[Backend Optimization]
  L --> M[Store Route Version]
  J --> N[Delivery Ready]
  M --> N
  N --> O[Notify Driver]
```

## 5. Communication Flow

```mermaid
flowchart LR
  O[Owner] -->|E2EE Chat Envelope| B[Backend]
  D[Driver] -->|E2EE Chat Envelope| B
  B -->|Authorized Relay| O
  B -->|Authorized Relay| D
  O -->|Call Request| B
  B -->|WebSocket or Push Wake-up| D
  O <--> |Encrypted WebRTC Media| M[Media Infrastructure]
  D <--> |Encrypted WebRTC Media| M
```

Backend may store encrypted message envelopes and minimal session metadata, but must not log plaintext private communication.

## 6. Delivery State Machine

```mermaid
stateDiagram-v2
  [*] --> ASSIGNED
  ASSIGNED --> ACCEPTED
  ACCEPTED --> EN_ROUTE
  EN_ROUTE --> ARRIVED
  ARRIVED --> UNLOADING
  UNLOADING --> DELIVERED
  EN_ROUTE --> FAILED
  ARRIVED --> FAILED
  UNLOADING --> FAILED
  FAILED --> RESCHEDULED
  RESCHEDULED --> ASSIGNED
  DELIVERED --> COMPLETED
  COMPLETED --> [*]
  EN_ROUTE --> CANCELLED
  ASSIGNED --> CANCELLED
  ACCEPTED --> CANCELLED
```

`CANCELLED` is only accepted when the current state and actor permission allow cancellation. A stale offline command cannot silently overwrite a newer state.

## 7. Route State

```mermaid
stateDiagram-v2
  [*] --> PLANNED
  PLANNED --> RECOMMENDED
  RECOMMENDED --> SELECTED
  PLANNED --> SELECTED
  SELECTED --> ACTIVE
  ACTIVE --> REORDERED
  REORDERED --> ACTIVE
  ACTIVE --> COMPLETED
```

## 8. Data Ownership

| Data | Owner | Driver | Admin |
|---|---|---|---|
| User master | Operational subset | Read self | Full / controlled override |
| Delivery | Create/manage | Execute own | Full / controlled override |
| Driver location | Read authorized | Write self | Full / controlled override |
| Route | Manage | Select/execute | Full |
| POD | Read | Create | Full |
| Chat | Participate | Participate | Controlled metadata/support |
| Audit log | Limited | No | Full |
| Secrets/keys | No direct access | No direct access | Controlled service/infrastructure only |

## 9. Security-Aware Data Flows

### Authentication and Session

```mermaid
flowchart LR
  C[Client] --> TLS[HTTPS/WSS]
  TLS --> A[Auth + Session Service]
  A --> V[Validate Credentials / Token]
  V --> S[(Session / Device Store)]
  V --> G[Role + Object Authorization]
  G --> P[Protected Process]
```

### Private Chat

```mermaid
flowchart LR
  O[Owner] --> E[Encrypt at Endpoint]
  E --> C[Ciphertext Envelope]
  C --> B[Backend Validate / Authorize / Relay]
  B --> D[Driver]
  D --> X[Decrypt at Endpoint]
```

### Secure Upload

```mermaid
flowchart LR
  D[Driver] --> U[Upload Request]
  U --> V[Auth + Authorization + File Validation]
  V --> S[(Private Object Storage)]
  S --> M[(File Metadata / Checksum)]
```

## 10. Network and Media Boundary

```mermaid
flowchart LR
  C[Owner / Driver / Admin Clients]
  CF[Cloudflare Web Proxy]
  API[HTTPS API / WSS]
  TURN[TURN / STUN Direct or Explicitly Validated L4 Path]
  RTC[WebRTC Media]
  B[Backend]
  PUSH[FCM / APNs]

  C --> CF
  CF --> API
  API --> B
  B --> PUSH
  C -. media connectivity .-> TURN
  TURN --> RTC
  C -. WebRTC .-> RTC
```

REST and WebSocket traffic may use the ordinary Cloudflare application path. TURN/STUN is a separate transport concern and must not be assumed to work through ordinary HTTP proxying.

## 11. Geocoding Data Flow

```text
Owner enters address
       ↓
Backend validates and normalizes text
       ↓
Geocoding provider
       ↓
Candidate coordinates + confidence/context
       ↓
Owner confirmation where ambiguous
       ↓
Destination / Stop stored with geometry
       ↓
Routing engine
       ↓
Route result
```

Geocoding and routing are separate services. Public geocoding endpoints must be used only within their published usage policy, with caching and rate limiting.

## 12. Offline Conflict Data Flow

```text
Driver command created offline
       ↓
Outbox + idempotency key + client event time
       ↓
Reconnect
       ↓
Backend loads current state
       ↓
Version / state transition check
   ┌──────┴──────┐
 Valid            Conflict
   ↓                 ↓
Apply            Preserve event/POD
   ↓                 ↓
Success       Exception review
                    ↓
             Owner / Admin decision
```

Baseline policy: server-authoritative transactional state plus evidence-preserving exception handling. A conflicting Driver POD/event is not deleted merely because a newer server state exists.

## 13. Mobile Wake-Up and Notification Flow

```mermaid
sequenceDiagram
  participant O as Owner
  participant B as Backend
  participant P as FCM/APNs
  participant D as Driver Device

  O->>B: Start PTT / Video request
  B->>B: Authenticate + authorize + create session
  alt Driver socket active
    B-->>D: Realtime signaling event
  else Driver socket unavailable
    B->>P: High-priority / VoIP-capable push according to platform policy
    P-->>D: Wake-up / incoming-call notification
  end
  D->>B: Reconnect / accept session
  B-->>O: Session ready
```

Push is a wake-up/notification mechanism, not a guarantee that arbitrary app code can execute indefinitely. Platform-specific restrictions and terminated/force-stopped cases must be tested.

## 14. Routing Complexity Boundary

```text
Stops
  ↓
Routing engine / matrix
  ↓
Candidate travel costs
  ↓
Backend optimizer
```

For `n <= 5` stops, exhaustive permutation can be used as a simple baseline. For `n > 5`, do not enumerate all permutations in the main request path. Use a heuristic such as Nearest Neighbor + 2-Opt, delegate to a routing engine's trip/optimization capability where suitable, or process optimization asynchronously.

## 15. PostGIS Spatial Flow

```mermaid
flowchart LR
  P[Validated coordinate] --> G[geometry(Point, 4326)]
  G --> IDX[GiST Spatial Index]
  G --> Z[Geofence / distance / bounding queries]
  Z --> R[Operational decision]
```

The canonical geospatial field should be a PostGIS geometry point; latitude/longitude may be retained as API/domain convenience fields but the database spatial column is used for spatial queries.
