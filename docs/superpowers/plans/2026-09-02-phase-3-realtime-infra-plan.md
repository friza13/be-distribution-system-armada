# Phase 3: Realtime Infrastructure, WebSocket Gateway, Session Heartbeat & Connection Revocation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun infrastruktur realtime WebSocket berbasis Socket.IO dan Redis Pub/Sub, handshake autentikasi JWT aman, penegakan single active socket untuk driver, pemutusan koneksi instan berbasis event revocation Redis (<1 detik), heartbeat ping/pong latency tracking dengan stale socket teardown, dan otorisasi room anti-IDOR.

**Architecture:** NestJS WebSocket Gateway (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`), Redis Pub/Sub Subscriber, `WsConnectionManagerService`, `WsJwtAuthGuard`, Prisma Service.

**Tech Stack:** Node.js 22 LTS, NestJS 10, Socket.IO 4, IORedis, Prisma 5.22.0, PostgreSQL 16 + PostGIS 3.4, Redis 7.

---

## Global Constraints

- **Namespace:** `/v1/realtime`
- **Frame Size Limit:** 32 KB per WebSocket frame
- **Handshake Auth:** JWT `HS256`, 15m expiration, type `ACCESS_TOKEN`, Redis revocation check (`revoked:session:<id>`, `revoked:user:<id>`)
- **Driver Policy:** Single active socket (`1 Driver = 1 Connected Socket`), superseding older socket on new login
- **Heartbeat Policy:** 25s ping interval, 10s pong timeout, auto-teardown of stale connections
- **Zero Plaintext Secrets:** Passwords, tokens, and private keys never broadcast over rooms or logged

---

## File Structure Map

```text
backend/
├── src/
│   ├── modules/
│   │   └── realtime/
│   │       ├── dto/
│   │       │   ├── join-room.dto.ts
│   │       │   └── realtime-envelope.dto.ts
│   │       ├── guards/
│   │       │   └── ws-jwt-auth.guard.ts
│   │       ├── services/
│   │       │   ├── ws-connection-manager.service.ts
│   │       │   └── ws-room-authorizer.service.ts
│   │       ├── gateways/
│   │       │   └── realtime.gateway.ts
│   │       └── realtime.module.ts
│   └── app.module.ts
├── test/
│   └── realtime/
│       ├── ws-auth-handshake.e2e-spec.ts
│       ├── ws-instant-revocation.e2e-spec.ts
│       ├── ws-driver-socket.e2e-spec.ts
│       ├── ws-heartbeat-teardown.e2e-spec.ts
│       ├── ws-room-authorization.e2e-spec.ts
│       └── ws-event-envelope.e2e-spec.ts
└── package.json
```

---

## Task Breakdown & Bite-Sized Steps

---

### Task 3.1: WebSocket Gateway Scaffold & JWT Handshake Authentication (`RT-INFRA-001`)

**Files:**
- Modify: `backend/package.json` (add `@nestjs/websockets@^10.2.0`, `@nestjs/platform-socket.io@^10.2.0`, `socket.io@^4.7.0`, `socket.io-client@^4.7.0`)
- Create: `backend/src/modules/realtime/dto/realtime-envelope.dto.ts`
- Create: `backend/src/modules/realtime/guards/ws-jwt-auth.guard.ts`
- Create: `backend/src/modules/realtime/services/ws-connection-manager.service.ts`
- Create: `backend/src/modules/realtime/gateways/realtime.gateway.ts`
- Create: `backend/src/modules/realtime/realtime.module.ts`
- Create: `backend/test/realtime/ws-auth-handshake.e2e-spec.ts`

- [ ] **Step 1: Install Socket.IO & WebSocket Dependencies**

Run: `cd backend && npm install @nestjs/websockets@^10.2.0 @nestjs/platform-socket.io@^10.2.0 socket.io@^4.7.0 && npm install -D socket.io-client@^4.7.0`

- [ ] **Step 2: Implementasikan `realtime-envelope.dto.ts` & `WsJwtAuthGuard`**

- `formatRealtimeEvent(event, payload, actor, correlationId?)`: membungkus payload dalam canonical envelope `{ eventId, event, version: 1, timestamp, correlationId, actor, payload }`.
- `WsJwtAuthGuard`:
  - Mengekstrak JWT dari `handshake.auth.token` atau `handshake.query.token`.
  - Memvalidasi tanda tangan `HS256`, `iss`, `aud`, dan `type === 'ACCESS_TOKEN'`.
  - Memeriksa Redis revocation cache (`revoked:session:<id>`, `revoked:user:<id>`).
  - Memeriksa user di DB (`status === 'ACTIVE'`).
  - Mengikat metadata ke `socket.data`.

- [ ] **Step 3: Implementasikan `RealtimeGateway` & `WsConnectionManagerService`**
  - Gateway mengelola koneksi masuk pada namespace `/v1/realtime`.
  - Mendaftarkan socket pada `WsConnectionManagerService` saat `handleConnection()`.
  - Membersihkan socket saat `handleDisconnect()`.

- [ ] **Step 4: Tulis E2E Test WS Handshake Authentication**
  - Buat `test/realtime/ws-auth-handshake.e2e-spec.ts`:
    - Valid JWT handshake $\rightarrow$ connection accepted.
    - Missing token $\rightarrow$ connection rejected (`UNAUTHORIZED`).
    - Expired token $\rightarrow$ connection rejected.
    - Tampered token $\rightarrow$ connection rejected.
    - Token dari user `DISABLED` / revoked $\rightarrow$ connection rejected.

---

### Task 3.2: Redis Revocation Listener & Instant Socket Disconnection (`RT-INFRA-002`)

**Files:**
- Modify: `backend/src/modules/realtime/services/ws-connection-manager.service.ts`
- Modify: `backend/src/modules/realtime/gateways/realtime.gateway.ts`
- Create: `backend/test/realtime/ws-instant-revocation.e2e-spec.ts`
- Create: `backend/test/realtime/ws-driver-socket.e2e-spec.ts`

- [ ] **Step 1: Implementasikan Redis Revocation Subscriber**
  - Subscribe ke Redis channel `security:revocation`.
  - Saat pesan diterima:
    - Jika `USER_REVOKED`: ambil semua socket milik `userId`, emit event `{ event: 'disconnect_notice', code: 'SESSION_REVOKED' }`, lalu panggil `socket.disconnect(true)`.
    - Jika `DEVICE_REVOKED`: putus socket milik `deviceId`.
    - Jika `ROLE_CHANGED`: putus socket milik `userId` dengan reason `ROLE_CHANGED`.

- [ ] **Step 2: Implementasikan Driver Single Active Socket Policy**
  - Di dalam `WsConnectionManagerService.registerSocket(socket)`:
    - Jika `socket.data.role === 'DRIVER'`:
      - Jika ada socket aktif lain untuk `driverId` tersebut $\rightarrow$ putus socket lama dengan reason `SUPERSEDED_BY_NEW_LOGIN`.

- [ ] **Step 3: Tulis E2E Tests Instant Revocation & Single Driver Socket**
  - Buat `test/realtime/ws-instant-revocation.e2e-spec.ts`:
    - Hubungkan socket $\rightarrow$ publish event Redis `USER_REVOKED` $\rightarrow$ verifikasi socket terputus $\rightarrow$ verifikasi reconnect ditolak 401.
  - Buat `test/realtime/ws-driver-socket.e2e-spec.ts`:
    - Driver connect Socket 1 $\rightarrow$ Driver connect Socket 2 $\rightarrow$ verifikasi Socket 1 diputus otomatis dan hanya Socket 2 yang aktif.

---

### Task 3.3: Heartbeat, Latency Tracking & Stale Socket Teardown (`RT-INFRA-003`)

**Files:**
- Modify: `backend/src/modules/realtime/gateways/realtime.gateway.ts`
- Modify: `backend/src/modules/realtime/services/ws-connection-manager.service.ts`
- Create: `backend/test/realtime/ws-heartbeat-teardown.e2e-spec.ts`

- [ ] **Step 1: Implementasikan Heartbeat Timer & Ping/Pong Handler**
  - Interval 25s: Server broadcast `ping` `{ serverTime: Date.now() }`.
  - Client handler `@SubscribeMessage('pong')`:
    - Server hitung latency: $\Delta t = \text{Date.now()} - \text{payload.pingServerTime}$.
    - Simpan `socket.data.latencyMs = Delta_t` dan `socket.data.lastPingAt = Date.now()`.

- [ ] **Step 2: Implementasikan Stale Socket Detector**
  - Loop setiap 10s: Periksa seluruh socket aktif.
  - Jika `Date.now() - socket.data.lastPingAt > 35000` (missed pong timeout 10s):
    - Putus socket dengan reason `STALE_HEARTBEAT_TIMEOUT`.
    - Catat audit log `SOCKET_STALE_TEARDOWN`.

- [ ] **Step 3: Tulis E2E Test Heartbeat & Stale Teardown**
  - Buat `test/realtime/ws-heartbeat-teardown.e2e-spec.ts`:
    - Hubungkan client $\rightarrow$ terima ping $\rightarrow$ kirim pong $\rightarrow$ latency terhitung.
    - Hubungkan client zombie (tidak kirim pong) $\rightarrow$ verifikasi server memutus socket setelah timeout.

---

### Task 3.4: Channel / Room Authorization & Anti-IDOR Defense

**Files:**
- Create: `backend/src/modules/realtime/dto/join-room.dto.ts`
- Create: `backend/src/modules/realtime/services/ws-room-authorizer.service.ts`
- Modify: `backend/src/modules/realtime/gateways/realtime.gateway.ts`
- Create: `backend/test/realtime/ws-room-authorization.e2e-spec.ts`
- Create: `backend/test/realtime/ws-event-envelope.e2e-spec.ts`

- [ ] **Step 1: Implementasikan `WsRoomAuthorizerService`**
  - `authorizeRoomJoin(socket, roomName)`:
    - `delivery:<id>`: verifikasi role (`ADMIN`/`OWNER` boleh, `DRIVER` hanya boleh jika `delivery.driverId === socket.data.driverId`).
    - `conversation:<id>`: verifikasi user adalah `ownerId` atau `driverId`.
    - `fleet:monitoring`: verifikasi role `ADMIN`, `SUPER_ADMIN`, `OWNER` (Driver ditolak).

- [ ] **Step 2: Implementasikan Gateway Room Handlers**
  - `@SubscribeMessage('join_room')`: Panggil `authorizeRoomJoin()`. Jika lolos $\rightarrow$ `socket.join(room)`. Jika gagal $\rightarrow$ emit `room_error` `{ code: 'ROOM_ACCESS_DENIED', room }`.
  - `@SubscribeMessage('leave_room')`: `socket.leave(room)`.

- [ ] **Step 3: Tulis E2E Tests Room Authorization & Event Envelope**
  - Buat `test/realtime/ws-room-authorization.e2e-spec.ts`:
    - Driver A mencoba join room Delivery Driver B ditolak `ROOM_ACCESS_DENIED`.
    - Driver A mencoba join `fleet:monitoring` ditolak `ROOM_ACCESS_DENIED`.
    - Admin join room delivery/fleet sukses.
  - Buat `test/realtime/ws-event-envelope.e2e-spec.ts`:
    - Verifikasi struktur event envelope (`eventId`, `event`, `version`, `timestamp`, `correlationId`, `actor`, `payload`).

---

## Verification Plan

### Automated Tests
- `npm run test` (Unit tests)
- `npm run test:e2e` (E2E tests: ws-auth-handshake, ws-instant-revocation, ws-driver-socket, ws-heartbeat-teardown, ws-room-authorization, ws-event-envelope)
- `npm run build` (Clean production build)

### Manual Verification
1. Connect via Socket.IO client tool with valid JWT: verify handshake success.
2. Publish Redis event `USER_REVOKED`: verify socket disconnects immediately.
3. Test concurrent Driver connection: verify second connection severs the first.
