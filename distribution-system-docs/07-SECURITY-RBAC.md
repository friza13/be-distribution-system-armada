# Security, RBAC, Audit & End-to-End Encryption Specification

**Document status:** Security baseline / design specification  
**Scope:** Admin Web, Owner Mobile, Driver Mobile, Backend API, realtime messaging, push-to-talk, voice/video calls, GPS tracking, POD/media, VPS infrastructure.

> **Security principle:** server-side TLS protects traffic in transit, but it is **not** sufficient for private communications. Chat, voice, and video are designed so that application payloads are encrypted at the endpoints. The backend routes encrypted data/session signaling but does not receive plaintext communication content.

## 1. Security goals

The system must:

- authenticate every user and device before accessing protected resources;
- enforce least privilege between Admin, Owner, and Driver;
- prevent cross-driver and cross-delivery data access;
- protect precise driver location and location history;
- protect credentials, tokens, POD files, chat content, call media, and emergency data;
- provide confidentiality and integrity against passive network attackers, including attackers on the same Wi-Fi/LAN;
- provide forward-security-oriented session design for private chat where the selected protocol supports it;
- prevent the backend, database operator, or network observer from reading E2EE chat/media plaintext;
- make security-sensitive administrative actions auditable;
- support device/session revocation and account deactivation;
- fail closed when authentication, authorization, key validation, or cryptographic integrity checks fail.

## 2. Threat model

### 2.1 In-scope attackers

The design considers:

```text
A. Passive network attacker
   └── can sniff packets on public Wi-Fi, company LAN, compromised access point,
       or an untrusted intermediate network.

B. Active network attacker
   └── can attempt packet injection, replay, downgrade, connection hijacking,
       or signaling manipulation.

C. Compromised/curious backend
   └── can read database rows, API payloads, logs, and encrypted message blobs,
       but must not be able to decrypt E2EE content using server-held data alone.

D. Unauthorized application user
   └── valid account but insufficient role/resource permission.

E. Stolen or lost device
   └── attacker obtains the physical phone but does not automatically obtain
       protected private keys stored in platform secure storage.
```

### 2.2 Out of scope / residual risk

E2EE does **not** protect against a compromised endpoint. If malware, a rooted/jailbroken environment, an accessibility abuse, screen recording, a malicious keyboard, or an attacker with unlocked-device access can read data after decryption, the application cannot guarantee confidentiality.

Likewise, E2EE cannot hide all metadata. The backend may still observe account identifiers, connection times, approximate traffic volume, delivery state, and other protocol metadata required to operate the service.

## 3. Cryptography decisions

### 3.1 Do not confuse hashing and encryption

The following are **not interchangeable**:

| Primitive | Purpose | Use in this system |
|---|---|---|
| SHA-256 | Hash | Integrity identifiers, fingerprints, hashing where appropriate |
| SHA-512 / SHA-512/224 | Hash | Optional KDF/hash component where a protocol specifies it |
| HMAC | Message authentication | Protocol/KDF construction where required |
| HKDF | Key derivation | Deriving keys from established key material where protocol requires it |
| AES-256-GCM | Authenticated encryption (AEAD) | Suitable application encryption primitive for non-Signal custom payloads / local file encryption where justified |
| ChaCha20-Poly1305 | Authenticated encryption (AEAD) | Suitable AEAD alternative, especially on platforms without AES acceleration |
| X25519 / approved DH | Key agreement | Used by established secure messaging/call key-management protocols |
| Ed25519 / approved signature scheme | Authentication/signatures | Device identity or protocol signature where required |

**SHA-256 or SHA-512/224 alone cannot encrypt a message.** SHA-256 only produces a digest. A secure design needs authenticated encryption plus a sound key-management protocol.

### 3.2 No custom cryptography

The project must **not invent a proprietary encryption algorithm, custom cipher, custom ratchet, or custom key-exchange protocol** merely to be “more secure”. Novel cryptography increases implementation and review risk.

Use established protocols and mature implementations. Custom code should be restricted to protocol integration, identity binding, storage, authorization, and application framing—not the cryptographic primitive itself.

## 4. Encryption layers

The system uses multiple independent layers because each solves a different problem.

```text
┌───────────────────────────────────────────────────────────────┐
│ Application E2EE                                              │
│                                                               │
│ Chat: established secure messaging protocol / ratchet         │
│ Media: WebRTC + DTLS-SRTP; SFrame when an SFU is introduced   │
└───────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼─────────────────────────────────┐
│ Transport security                                            │
│                                                               │
│ HTTPS / WSS with modern TLS                                   │
│ WebRTC signaling protected by HTTPS/WSS                       │
└───────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼─────────────────────────────────┐
│ Storage security                                              │
│                                                               │
│ DB access controls + encrypted backups + secret management    │
│ Platform secure storage for device/private keys               │
└───────────────────────────────────────────────────────────────┘
```

The layers are deliberately redundant. For example, E2EE protects message content from a compromised backend, while TLS protects transport metadata and connection integrity between client and backend.

## 5. Private chat: end-to-end encryption

### 5.1 Security target

For Owner ↔ Driver chat, the system should use an established authenticated end-to-end messaging protocol with:

- asynchronous session establishment;
- authenticated key agreement;
- per-message key evolution / ratcheting;
- forward secrecy properties;
- replay/out-of-order handling;
- authenticated ciphertext;
- encrypted message content before transmission to the backend.

The Signal specifications describe X3DH-style asynchronous key agreement and Double Ratchet messaging. X3DH establishes a shared secret between authenticated public keys, while Double Ratchet derives new message keys over time and is designed to provide protection for earlier/later messages after some key compromise. citeturn857918search0turn857918search2turn857918search1

### 5.2 Recommended protocol direction

For a small Owner ↔ Driver 1:1 communication system, use a mature implementation of the **Signal Protocol family** (or another mature, independently reviewed E2EE protocol with equivalent guarantees) rather than implementing X3DH/Double Ratchet manually.

The official Signal documentation publishes specifications for X3DH, Double Ratchet, and session management. Signal's current `libsignal` repository exposes protocol APIs, but its repository explicitly states that the library is used by Signal and that use outside Signal is unsupported; licensing and platform integration therefore have to be evaluated before selecting it as a project dependency. citeturn857918search0turn581294search0turn581294search1

**Implementation decision:**

> Select the protocol implementation only after checking Flutter/mobile platform support, maintenance status, security history, and licensing. Do not copy cryptographic code from examples or implement a “Signal-like” protocol ourselves.

### 5.3 Conceptual message flow

```text
OWNER MOBILE                           BACKEND                         DRIVER MOBILE
     │                                    │                                  │
     │ 1. fetch authenticated key info    │                                  │
     ├───────────────────────────────────►│                                  │
     │◄───────────────────────────────────┤                                  │
     │                                    │                                  │
     │ 2. establish E2EE session locally  │                                  │
     │──────────────────────────────────────────────────────────────────────►│
     │                                    │                                  │
     │ 3. plaintext exists only here      │                                  │
     │                                    │                                  │
     │ 4. encrypt locally                 │                                  │
     │                                    │                                  │
     │ 5. ciphertext + protocol metadata  │                                  │
     ├───────────────────────────────────►│                                  │
     │                                    │ 6. store/forward ciphertext       │
     │                                    ├─────────────────────────────────►│
     │                                    │                                  │
     │                                    │ 7. ciphertext received            │
     │                                    │                                  │
     │                                    │                       decrypt local│
     │                                    │                                  │
```

The backend should never need the chat plaintext to route messages.

### 5.4 Server-side storage rule

The database should store encrypted envelopes such as:

```text
message_id
conversation_id
sender_device_id
recipient_device_id / routing metadata
protocol_version
ciphertext
key/session metadata required by the protocol
created_at
delivery_status
```

The backend must **not** store a separate plaintext `message_body` column for E2EE messages.

Search over E2EE message content must therefore be client-side or explicitly excluded from scope. Server-side full-text search over plaintext would defeat the confidentiality goal.

## 6. Identity binding and anti-MITM protection

Encryption alone is not enough. A malicious network or compromised signaling server could attempt to substitute another party's public identity key unless identities are authenticated/bound correctly.

The system should provide an application-level device identity and verification mechanism:

```text
Account
  ↓
Device enrollment
  ↓
Generate device identity keys locally
  ↓
Public identity / prekey material published to backend
  ↓
Owner ↔ Driver establish session
  ↓
Optional verification:
QR code / safety number / fingerprint
```

Recommended properties:

- private identity keys generated on the endpoint;
- private keys never uploaded as plaintext;
- public keys may be stored by the backend;
- identity changes trigger a visible warning;
- users can verify the remote identity through an out-of-band or QR-based flow for higher assurance;
- a verified identity change should require re-verification before sensitive communications continue.

## 7. Voice / Push-to-Talk / Video security

### 7.1 WebRTC transport security

Use **WebRTC** for realtime voice and video. WebRTC's security architecture requires media to be protected with SRTP/SRTCP and requires DTLS-SRTP for media keying; data channels are protected with DTLS. Plain RTP/RTCP must not be used. citeturn857918search3

Therefore:

```text
Owner Phone                         Driver Phone
     │                                  │
     │<───── encrypted WebRTC media ───>│
     │                                  │
     └──── DTLS-SRTP / SRTP / SRTP ────┘
```

A passive attacker on the same Wi-Fi should see encrypted packets, not intelligible voice/video content.

### 7.2 TURN server

When direct peer-to-peer connectivity is impossible, use a TURN server as a relay.

```text
Owner ── encrypted WebRTC packets ──► TURN ── encrypted packets ──► Driver
```

TURN forwards packets; it must not be designed as a media decryption endpoint.

### 7.3 Signaling security

WebRTC signaling is application-defined. Protect it with:

- HTTPS/WSS;
- authenticated users/devices;
- authorization that only the relevant Owner/Driver can join a call;
- short-lived call/session identifiers;
- anti-replay checks for signaling events;
- authenticated binding between the call peer identity and the expected Owner/Driver device identity.

Do not treat possession of a WebRTC room ID as authorization.

### 7.4 When an SFU is used

If the project later adds an SFU for scalability, ordinary DTLS-SRTP from each endpoint to the SFU protects transport hops but does not by itself guarantee that the SFU cannot access media plaintext.

For true media E2EE through an SFU, use an additional application/media protection layer such as **SFrame**. RFC 9605 specifically defines SFrame as an E2EE mechanism for realtime media so an SFU can forward media without possessing the keys needed to decrypt the media payload. citeturn702731search0turn702731search3

This creates two layers:

```text
Owner
  │
  │ E2EE media payload
  │
  ▼
SFU / relay
  │
  │ forwards encrypted media
  ▼
Driver
```

For the first MVP, prefer **1:1 WebRTC** when feasible. Do not introduce an SFU solely for architecture aesthetics.

## 8. Push-to-Talk design

Push-to-talk is treated as an encrypted WebRTC audio session rather than as a custom raw socket audio stream.

```text
Owner presses/holds TALK
          ↓
authenticated signaling
          ↓
WebRTC session
          ↓
DTLS-SRTP encrypted audio
          ↓
Driver speaker
```

Recommended controls:

- only the authorized Owner can initiate PTT to the assigned Driver;
- Driver cannot initiate PTT when the product requirement intentionally makes Owner the initiator;
- the Driver can clearly see who is speaking/requesting a session;
- microphone permission is explicit;
- call/PTT sessions are logged as metadata only, not plaintext audio;
- recording is disabled by default unless explicitly introduced as a separately authorized feature.

## 9. Video call design

```text
Owner
  │
  │ Request Video
  ▼
Backend signaling
  │
  ▼
Driver
  │
  ├── Accept
  └── Decline
          │
          ▼
     WebRTC session
          │
          ▼
  Encrypted audio/video
```

Important controls:

- a camera request does not automatically activate the Driver camera;
- Driver must explicitly grant access unless product policy defines another explicit consent flow;
- camera/microphone permissions are handled by the mobile OS;
- call authorization is checked server-side;
- media is not stored unless a future feature explicitly defines recording, retention, and additional E2EE storage requirements.

## 10. E2EE media key management

Do not invent a second custom cryptographic protocol for generating call media keys.

For direct WebRTC, rely on the WebRTC security architecture for transport/media key establishment. For an SFU architecture requiring media confidentiality from the SFU, add SFrame and an established application key-management design rather than placing a static AES key in the server.

Any long-term application identity keys required for E2EE must be generated and stored on the endpoint using platform-protected storage where practical.

## 11. File and POD encryption

Proof-of-delivery files may include photos, signatures, and documents.

### 11.1 In transit

All uploads/downloads use HTTPS/TLS.

### 11.2 At rest

Use object storage or an equivalent file store with server-side encryption and strict authorization. High-sensitivity POD files may additionally use application-level encryption if the threat model requires the storage operator to be unable to read them.

### 11.3 Access control

Never expose permanent public URLs. Use short-lived authorized download URLs or an authenticated download endpoint.

## 12. Password and account security

Recommended baseline:

- Argon2id for password hashing where supported by the backend;
- never store plaintext passwords;
- refresh-token/session rotation or equivalent secure session management;
- session/device revocation;
- brute-force protection;
- login and recovery rate limiting;
- strong server-side session expiration policy;
- stronger authentication requirements for Admin;
- reauthentication for high-impact administrative actions.

PINs used for application unlock are **not a replacement for server authentication**. A local PIN protects the application/device experience; the backend still needs proper account/session authentication.

## 13. Authorization model

Authorization must evaluate:

```text
Authenticated identity
       +
Role
       +
Permission
       +
Resource ownership / scope
       +
Operational state
```

Example:

```text
Driver A requests Delivery B
        ↓
Authenticated?                 YES
Role DRIVER?                   YES
Assigned to Delivery B?        NO
        ↓
403 Forbidden
```

## 14. RBAC matrix

| Capability | Admin | Owner | Driver |
|---|---:|---:|---:|
| Manage Admin | ✅ | ❌ | ❌ |
| Manage Owner | ✅ | ❌ | ❌ |
| Create Driver | ✅ | ✅ | ❌ |
| Edit/disable Driver | ✅ | ✅ scoped | ❌ |
| Manage Vehicle | ✅ | ✅ | ❌ |
| Create Delivery | ✅ | ✅ | ❌ |
| Assign Driver | ✅ | ✅ | ❌ |
| View Fleet Map | ✅ | ✅ | ❌ |
| Send GPS | controlled | ❌ | ✅ own device |
| Choose Route | ✅ | ✅ | ✅ permitted |
| Chat | ✅ controlled | ✅ | ✅ |
| Start PTT | ✅ controlled | ✅ | ❌ |
| Receive PTT | ✅ controlled | ✅ | ✅ |
| Request Video | ✅ controlled | ✅ | ❌ |
| Accept Video | ✅ controlled | ✅ | ✅ |
| Create POD | ✅ override | view | ✅ |
| Audit Log | ✅ | limited | ❌ |
| System Config | ✅ | ❌ | ❌ |
| Emergency Override | ✅ | ✅ | SOS only |

**Important:** role checks alone are insufficient. Resource ownership/scope checks must also be performed for driver, delivery, communication session, POD, route, and location resources.

## 15. API security

### 15.1 HTTPS/WSS

All external API and WebSocket endpoints must use HTTPS/WSS. Plain HTTP must redirect only where appropriate for public endpoints and must never be accepted for authenticated application traffic.

### 15.2 Token handling

- access tokens are short-lived;
- refresh tokens are protected and rotated/revoked according to the session design;
- tokens are stored in platform-secure storage on mobile;
- never put long-lived secrets in source code;
- never log access/refresh tokens;
- avoid placing secrets in query strings.

### 15.3 API controls

- input validation;
- output encoding where applicable;
- rate limiting;
- request size limits;
- consistent authorization middleware/guards;
- anti-replay/idempotency controls for security-sensitive operations;
- safe error messages without secret leakage;
- structured security logging.

## 16. GPS and location security

Treat precise driver location as sensitive data.

Controls:

- location updates are accepted only from authenticated driver devices;
- a driver can submit only their own location;
- Owner sees only drivers within their authorized company/scope;
- location history has a defined retention period;
- backend validates timestamp freshness and unreasonable jumps where practical;
- location packets are authenticated and transported over WSS/HTTPS;
- do not expose raw location-history endpoints publicly;
- audit access to historical tracking where appropriate.

The location payload should include enough telemetry to detect stale or suspicious reports:

```text
latitude
longitude
accuracy
speed
heading
recorded_at
received_at
source_device_id
```

## 17. Device security

Mobile apps should:

- use Android Keystore / iOS Keychain or equivalent protected storage for sensitive keys/tokens;
- never persist private identity keys in plaintext;
- avoid storing plaintext message content outside the intended chat database;
- clear sensitive temporary buffers/files where practical;
- detect logout/session revocation;
- allow Admin to revoke a lost device/session;
- react safely when location, microphone, camera, or notification permissions are revoked.

## 18. Audit logging

Minimum audit events:

```text
USER_CREATED
USER_UPDATED
USER_DISABLED
ROLE_CHANGED
PASSWORD_RESET_INITIATED
DEVICE_ENROLLED
DEVICE_REVOKED
DELIVERY_CREATED
DELIVERY_UPDATED
DRIVER_ASSIGNED
ROUTE_SELECTED
ROUTE_CHANGED
POD_CREATED
POD_REPLACED
E2EE_SESSION_ESTABLISHED
E2EE_IDENTITY_CHANGED
VOICE_SESSION_STARTED
VOICE_SESSION_ENDED
VIDEO_REQUESTED
VIDEO_ACCEPTED
VIDEO_DECLINED
EMERGENCY_CREATED
EMERGENCY_RESOLVED
ADMIN_OVERRIDE
```

Do **not** log:

```text
plaintext chat messages
plaintext call audio/video
passwords
private cryptographic keys
access/refresh tokens
```

## 19. Logging and observability security

Application logs should use redaction and structured fields.

Safe example:

```text
call_id=CALL-123
owner_id=OWN-01
driver_id=DRV-07
event=VIDEO_ACCEPTED
```

Unsafe example:

```text
message="The customer gave us 50 boxes..."
token="eyJ..."
private_key="..."
```

## 20. Security events and alerts

The system should be able to detect or at least record:

- repeated login failures;
- abnormal token/session use;
- device identity changes;
- revoked device attempts to reconnect;
- unusual GPS jumps or stale timestamps;
- repeated forbidden API requests;
- unexpected role/permission changes;
- emergency events;
- repeated failed E2EE/decryption/session establishment events.

## 21. Backup and key-management rule

Database backups do not automatically provide a recoverable E2EE conversation history.

Because private communication keys are endpoint-controlled, backup design must explicitly define whether and how E2EE session state is recoverable. A generic database backup must never contain plaintext private keys merely to make recovery easier.

For the initial MVP, prioritize secure device/session enrollment and revocation. A future multi-device recovery design should be specified separately before implementation.

## 22. Security testing requirements

The BE/Security team should test at minimum:

### Authentication

```text
wrong password
expired token
revoked token
revoked device
brute-force throttling
```

### Authorization

```text
Driver A → Driver B delivery      = DENY
Driver → fleet map                = DENY
Owner → Admin management          = DENY
Driver → system config            = DENY
Owner → unauthorized driver       = DENY
```

### Network confidentiality

```text
same Wi-Fi packet capture
      ↓
no readable chat plaintext
no readable PTT audio
no readable video media
```

### E2EE integrity

```text
modify ciphertext
      ↓
authentication/decryption failure
```

```text
replay old message/session packet
      ↓
rejected or safely handled by protocol
```

### Identity security

```text
replace remote identity key
      ↓
identity-change warning / verification failure
```

### Media authorization

```text
unauthorized user attempts to join call
      ↓
rejected by signaling authorization
```

## 23. Minimum acceptance criteria for communication security

The communication feature can be considered security-complete for MVP only when all of the following are demonstrated:

1. Chat plaintext is encrypted before leaving the sender endpoint.
2. Backend/database contains ciphertext rather than chat plaintext.
3. Chat decryption occurs only on authorized recipient device(s).
4. WebRTC voice/video uses encrypted media transport and never plain RTP/RTCP. citeturn857918search3
5. A packet capture on the same LAN/Wi-Fi cannot reconstruct readable call audio/video or chat content.
6. Signaling endpoints enforce authentication and call authorization.
7. Call media is not decrypted by TURN.
8. If an SFU is introduced, SFrame or an equivalent E2EE media mechanism is implemented before claiming that the SFU cannot read media. citeturn702731search0turn702731search3
9. Identity/key changes are detectable and handled explicitly.
10. Private keys, passwords, and tokens are not present in logs.

## 24. Security architecture summary

```text
                          ┌──────────────────────────────┐
                          │         ADMIN WEB             │
                          │ RBAC / Audit / Management    │
                          └──────────────┬───────────────┘
                                         │ HTTPS
                                         ▼
┌───────────────────┐             ┌────────────────────────┐
│   OWNER MOBILE    │             │       BACKEND          │
│                   │             │                        │
│ device identity   │◄───────────►│ Auth / RBAC             │
│ secure key store  │  TLS/WSS    │ Delivery               │
│ E2EE chat         │             │ Location               │
│ WebRTC media      │             │ Signaling              │
└─────────┬─────────┘             │ Ciphertext storage     │
          │                       │ Audit                  │
          │ E2EE WebRTC           └───────────┬────────────┘
          │                                   │
          │                           encrypted storage
          │                                   │
          ▼                                   ▼
┌───────────────────┐                 ┌─────────────────────┐
│   DRIVER MOBILE   │                 │ DB / Object Storage │
│                   │                 │                     │
│ device identity   │                 │ no plaintext E2EE   │
│ secure key store  │                 │ chat content        │
│ E2EE chat         │                 │ strict authorization │
│ WebRTC media      │                 └─────────────────────┘
└───────────────────┘
```

## 25. Recommended security baseline

| Area | Baseline |
|---|---|
| API transport | HTTPS/TLS |
| WebSocket | WSS/TLS |
| Password hashing | Argon2id |
| Chat | Mature E2EE protocol; Signal-family approach is a candidate for 1:1 |
| Chat integrity/confidentiality | Protocol-provided authenticated encryption + ratcheting |
| Voice | WebRTC + DTLS-SRTP/SRTP |
| Video | WebRTC + DTLS-SRTP/SRTP |
| SFU E2EE | SFrame when SFU is used |
| PTT | WebRTC audio session |
| Device keys | Android Keystore / iOS Keychain |
| Sensitive files | TLS + encrypted object storage; optional application-level encryption |
| Access control | RBAC + resource ownership/scope |
| Admin security | MFA/re-authentication preferred for production |
| Audit | Security-sensitive events, no plaintext secrets/content |
| Network attack | Explicit same-LAN/Wi-Fi capture test |

## 26. Security boundaries and honest claims

The product documentation should say:

> “Private communication is protected with end-to-end encryption at the application/media layer. Network transport is additionally protected with TLS and WebRTC security mechanisms.”

Avoid the stronger but technically inaccurate claim:

> “Nobody can ever listen under any circumstances.”

The correct security claim is conditional: a passive or network-level attacker should not be able to recover the plaintext when the endpoints and cryptographic identity state are uncompromised. Endpoint compromise, malicious device users, or future intentionally added recording features remain separate threats.

## 27. References

- Signal Protocol documentation and specifications: X3DH, Double Ratchet, and session-management materials. citeturn857918search0turn857918search2turn857918search1turn857918search4
- WebRTC Security Architecture, RFC 8827. citeturn857918search3
- Secure Frame (SFrame), RFC 9605. citeturn702731search0turn702731search3
- Messaging Layer Security, RFC 9420, as a future option if multi-party/group secure messaging is introduced. citeturn702731search1

## 28. Device/session management

Authentication is not complete when a JWT is issued. The backend must maintain revocable sessions/devices and bind refresh credentials to a server-side session record or equivalent protected state.

Minimum capabilities:

- list/review active sessions where appropriate;
- revoke one device/session;
- revoke all sessions for a user;
- invalidate sessions after account disablement;
- detect refresh-token/session reuse when the selected design supports rotation;
- require re-authentication for selected high-risk administrative actions.

## 29. Object-level authorization / IDOR-BOLA defense

Every read and mutation must validate both **role/permission** and **resource scope**.

```text
Authenticated?
   ↓ yes
Has permission?
   ↓ yes
Owns / is assigned / is within operational scope?
   ↓ yes
Current resource state allows action?
   ↓ yes
Execute
```

Examples:

- Driver can read/write only their own assigned delivery/location/POD.
- Owner can operate only within the company/scope granted by backend.
- Admin may perform full management actions according to administrative permissions.
- URL/ID guessing must never provide access to another driver's data.

## 30. Idempotency, replay and state protection

Critical commands must use idempotency keys or equivalent duplicate suppression. State transitions remain authoritative on the server.

Replay-sensitive operations include:

- delivery completion/failure;
- stop arrival/completion;
- POD submission;
- route selection/update;
- SOS creation/update;
- session creation/accept/decline;
- selected message commands.

Realtime events should include unique identifiers, timestamps/sequence information where needed, and session authorization. Old or invalid commands must be rejected.

## 31. Secure file upload and object access

POD photos, signatures, attachments, and future media are untrusted input.

Required controls:

- maximum file size by type;
- allowlist of supported file classes;
- MIME/extension consistency validation;
- generated object keys instead of trusting user filenames;
- storage outside executable web roots;
- object access authorization;
- integrity checksum where useful;
- malware scanning when operationally available;
- temporary/signed download URLs where appropriate;
- upload/download audit events without logging sensitive content.

## 32. GPS integrity, spoofing and retention

The server shall treat mobile GPS as client-provided telemetry, not unquestionable truth. Validate:

- coordinate range;
- timestamp freshness/future timestamps;
- accuracy thresholds;
- impossible speed/heading changes;
- implausible jumps;
- duplicate points;
- driver assignment/active-delivery state.

Store `accepted/flagged/rejected` or equivalent quality state where useful. Location history requires retention and role-based access policy.

## 33. WebSocket security

WebSocket/WSS must enforce authentication, channel authorization, per-event validation, message-size limits, rate limiting, heartbeat/reconnect handling, and revocation-aware disconnect behavior.

## 34. WebRTC signaling security

The backend is responsible for call authorization, session lifetime, signaling validation, participant binding, scoped temporary credentials, and audit metadata. TURN/STUN infrastructure is an operational dependency owned with Infra/DevOps, but the BE defines authorization and credential requirements.

## 35. Notification privacy

Push notifications must avoid exposing protected details on lock screens. Prefer opaque notification text plus in-app retrieval after authentication.

## 36. Dependency and supply-chain security

- Use supported/LTS runtime and library lines for production.
- Keep lockfiles committed.
- Review dependency advisories before release.
- Avoid abandoned, unsigned, or unnecessary packages.
- Perform automated dependency vulnerability scans.
- Never copy secrets or generated credentials into package source/config.

## 37. Security acceptance evidence

The BE/Security release gate should include evidence for:

1. authentication/session revocation;
2. IDOR/BOLA prevention;
3. duplicate/idempotent mutation behavior;
4. same-Wi-Fi traffic confidentiality;
5. WebSocket authorization;
6. WebRTC signaling authorization;
7. upload validation;
8. GPS outlier handling;
9. log/secret leakage checks;
10. dependency vulnerability review.


## 22. Device and Session Security

JWT authentication is only one part of session security. The backend shall maintain enough session/device state to revoke credentials after account disablement, device loss, refresh-token compromise, or administrative action.

Controls:

- short-lived access tokens;
- refresh-token rotation and revocation;
- refresh-token family/reuse detection where supported;
- device/session inventory;
- logout and revoke-device flows;
- immediate server-side authorization denial after account suspension/disablement;
- security events for anomalous session behavior.

## 23. Object-Level Authorization / IDOR-BOLA Prevention

Authentication does not grant access to arbitrary resource IDs. Every resource access must evaluate the authenticated user's allowed scope.

Examples:

```text
GET /deliveries/del_123
        ↓
Is user authenticated?
        ↓
Does role allow delivery read?
        ↓
Does user own/manage/execute del_123?
        ↓
Allow / Deny
```

Driver access is restricted to authorized deliveries, stops, messages, sessions, and own location data. UI hiding is never a substitute for backend authorization.

## 24. Secure File Upload and Object Access

POD photos, signatures, attachments, and future media uploads are attack surfaces.

Required controls:

- strict size and type limits;
- extension and content-type consistency checks;
- generated object keys rather than trusted filenames;
- private-by-default object storage;
- object-level authorization on download;
- temporary/signed access URLs where appropriate;
- malware/content scanning when available;
- audit metadata without logging sensitive file contents.

## 25. Anti-Replay and Event Integrity

Sensitive commands shall include replay/idempotency controls appropriate to their operation. Backend processing should validate event ID/nonce, freshness, state version, and idempotency where applicable.

This applies to status changes, POD submission, emergency events, WebSocket commands, and WebRTC signaling.

## 26. GPS Integrity and Anti-Spoof/Outlier Handling

The backend shall treat mobile GPS input as untrusted input. It shall validate:

- coordinate bounds;
- stale/future timestamps;
- impossible movement/speed;
- suspicious jumps;
- duplicate events;
- low-accuracy points;
- active delivery/device association.

The system may reject, flag, or downgrade confidence rather than blindly overwriting the latest trusted position.

## 27. Logging Model

Logging shall be separated conceptually into:

```text
Audit Log
Security Event Log
Application Log
Error Log
Access Log
Realtime/Session Log
```

Sensitive values must never be logged, including passwords, raw JWT/refresh tokens, encryption keys, private E2EE material, TURN credentials, raw authorization headers, or plaintext E2EE message/media content.

Log sanitization shall also address header injection, control characters, untrusted identifiers, and accidental object serialization.

## 28. Notification Privacy

Push notifications shall expose only the minimum operational information required. Sensitive delivery/chat details should be retrieved after the authenticated application is opened rather than placed in clear text on lock-screen notifications.

## 29. Cryptographic Fallback Classification

If a mature true-E2EE implementation cannot be completed for the initial milestone, the system shall not mislabel an application-layer AES-GCM scheme with server-managed keys as E2EE. Such a fallback is classified as encrypted application messaging over TLS with server-readable ciphertext/key material according to the documented key model. True E2EE remains a separate hardening milestone.


## 24. Mobile Wake-Up Security

WebSocket availability must not be treated as guaranteed for mobile devices. Owner-initiated PTT/video requests use a durable backend session state and platform push fallback when the Driver socket is unavailable.

Security requirements:

- push token belongs to an authenticated device record;
- notification content is minimized;
- pending call/session state remains authoritative in backend;
- Driver acceptance triggers a fresh authorization check;
- revoked/disabled devices cannot accept or continue protected sessions;
- replayed/stale call requests are rejected;
- push credentials are stored as deployment secrets and never logged.

## 25. WebRTC / TURN Network Boundary

Ordinary Cloudflare HTTP/HTTPS proxying must not be used as if it were a generic UDP relay. REST and WSS may use the ordinary protected application path. TURN/STUN requires a separately validated UDP/L4 path, typically DNS-only/direct unless a suitable Cloudflare network product is explicitly configured and tested.

## 26. Geospatial Security

Location data is sensitive and treated as untrusted client input. Backend must:

- validate coordinate ranges;
- validate timestamp freshness/skew;
- reject/flag impossible movement;
- enforce driver/delivery authorization;
- store server receive time;
- apply retention/access policy;
- use indexed PostGIS geometry for spatial queries.

## 27. Resource / Algorithm Abuse Protection

Route recommendation endpoints must enforce a stop-count policy so factorial enumeration cannot be used to exhaust CPU. For `n > 5`, use heuristic/engine-assisted optimization and apply request/resource limits.

Spatial and geocoding endpoints must also be rate-limited to prevent provider abuse and backend resource exhaustion.
