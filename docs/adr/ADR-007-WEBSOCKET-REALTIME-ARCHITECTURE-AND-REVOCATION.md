# ADR-007: WebSocket Realtime Architecture, Handshake Authentication, Channel Authorization & Instant Revocation

- **Status:** ACCEPTED (Phase 3 Baseline)
- **Deciders:** BE Lead, Security Lead, Realtime Architect
- **Date:** 2026-09-02
- **Technical Context:** NestJS 10, Socket.IO 4, Redis 7 (Pub/Sub Adapter), PostgreSQL 16 + PostGIS 3.4.

---

## 1. Context & Problem Statement

Sistem Distribution Management System membutuhkan arsitektur komunikasi realtime bidirectional untuk:
1. Telemetri pelacakan posisi armada driver (GPS streaming).
2. Notifikasi instan perubahan status pesanan & rute pengiriman.
3. Pertukaran pesan obrolan terenkripsi (E2EE Chat) & signaling WebRTC (Voice PTT / Video).
4. Sinyal darurat (SOS Emergency).
5. **Instant Security Revocation:** Pemutusan koneksi socket secara instan saat sesi dicabut atau akun dinonaktifkan.

Tantangan utama yang harus diselesaikan:
- **Handshake Authentication:** Bagaimana memvalidasi JWT access token, mengikat socket ke `userId`, `deviceId`, dan `sessionId`, serta mencegah token yang telah di-revoke terhubung.
- **Channel / Room Authorization (IDOR Defense):** Mencegah Driver A menguping atau berlangganan room data pengiriman Driver B.
- **Multi-Instance Scaling:** Menjamin event realtime tersampaikan antar-instance backend yang berbeda melalui Redis Pub/Sub.
- **Instant Revocation Semantics:** Memutus koneksi aktif dalam waktu < 1 detik ketika akun/device/sesi di-revoke di layer HTTP.
- **Heartbeat & Stale Connection Teardown:** Mendeteksi koneksi zombie / putus jaringan mobile dan membersihkan resource server.

---

## 2. Decision & Architecture Rules

### 2.1 WebSocket Engine & Transport Protocol
1. **Pustaka Terpilih:** **Socket.IO** (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`) dengan adapter **`@socket.io/redis-adapter`**.
2. **Namespace:** `/v1/realtime` (WSS pada production, WS pada local test).
3. **Frame Size Limit:** Maksimal **32 KB** per WebSocket frame untuk mencegah DoS buffer exhaustion.

### 2.2 Strict Handshake Authentication
1. Client mengirimkan access token via `auth: { token: "Bearer <jwt>" }` (atau query parameter `?token=<jwt>`).
2. Handshake Guard memverifikasi:
   - Tanda tangan `HS256`, `iss === 'dms-api'`, `aud === 'dms-clients'`, `type === 'ACCESS_TOKEN'`, dan `exp` belum habis.
   - Redis Revocation Cache: `EXISTS revoked:session:<sessionId>` dan `EXISTS revoked:user:<userId>`.
   - Status user di database: `status === 'ACTIVE'` dan role cocok.
3. Jika valid $\rightarrow$ Data sesi disimpan di `socket.data`:
   `{ userId, role, deviceId, sessionId, driverId, joinedRooms: Set<string> }`.
4. Jika tidak valid $\rightarrow$ Handshake ditolak seketika (`UNAUTHORIZED`).

### 2.3 Connection Management & Single Active Driver Socket
1. **Driver Operational Policy:** *1 Driver = 1 Active Socket*. Jika driver terhubung dari socket baru (misal reconnect setelah network drop), socket lama milik driver tersebut otomatis diputus dengan reason `SUPERSEDED_BY_NEW_LOGIN`.
2. **Owner/Admin Policy:** Multi-socket diizinkan (dashboard web, mobile monitoring, tablet).

### 2.4 Instant Connection Revocation via Redis Pub/Sub
1. Backend mendengarkan channel Redis `security:revocation`.
2. Ketika event `USER_REVOKED`, `DEVICE_REVOKED`, atau `ROLE_CHANGED` diterima dari instance mana pun:
   - Gateway mencari socket aktif yang memiliki `userId`, `deviceId`, atau `sessionId` yang cocok.
   - Mengirimkan event penutupan ke client: `{ event: "disconnect_notice", code: "SESSION_REVOKED" }`.
   - Memutus socket seketika via `socket.disconnect(true)` dalam hitungan detik.
3. Percobaan reconnect setelahnya akan langsung ditolak pada tahap handshake karena key `revoked:user:<userId>` / `revoked:session:<sessionId>` masih aktif di Redis.

### 2.5 Room Authorization & Anti-IDOR Defense
Setiap request `join_room` wajib melalui pemeriksaan izin (*authorization guard*):
- `delivery:<deliveryId>`:
  - Driver hanya boleh bergabung jika `delivery.driverId === socket.data.driverId`.
  - Admin dan Owner diizinkan bergabung.
  - Driver lain yang mencoba bergabung akan ditolak dengan event error `ROOM_ACCESS_DENIED`.
- `conversation:<conversationId>`:
  - Hanya user yang terdaftar sebagai `ownerId` atau `driverId` pada percakapan tersebut yang boleh bergabung.
- `fleet:monitoring`:
  - Khusus role `ADMIN`, `SUPER_ADMIN`, dan `OWNER`. Role `DRIVER` ditolak.

### 2.6 Heartbeat, Latency Measurement & Stale Socket Teardown
1. **Interval:** Server mengirim `ping` event setiap **25 detik** dengan payload `{ serverTime: Date.now() }`.
2. **Client Response:** Client merespons dengan event `pong` `{ clientTime: Date.now(), pingServerTime: number }`.
3. **Latency:** Server menghitung round-trip latency $\Delta t = \text{Date.now()} - \text{pingServerTime}$ dan mengupdate `socket.data.latencyMs`.
4. **Timeout & Teardown:** Jika client tidak merespons `pong` dalam waktu **10 detik** (total 35s inaktivitas), socket dianggap *stale* (zombie connection) dan diputus paksa dengan reason `STALE_HEARTBEAT_TIMEOUT`.

### 2.7 Canonical Realtime Event Envelope
Seluruh event yang dipancarkan server wajib dibungkus dalam envelope terstandarisasi:
```json
{
  "eventId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "event": "driver.location.updated",
  "version": 1,
  "timestamp": "2026-09-02T10:20:00.000Z",
  "correlationId": "c8f5f0b4-3a7e-46d2-850f-2b1b51e0cf9b",
  "actor": {
    "userId": "b8a34f89-8d7e-4a61-9c60-84a92c304d91",
    "role": "DRIVER",
    "deviceId": "550e8400-e29b-41d4-a716-446655440000"
  },
  "payload": { ... }
}
```

---

## 3. Consequences & Governance
- Pustaka `@socket.io/redis-adapter` menjamin skabilitas horizontal di masa depan.
- Socket frame dilimitasi 32 KB untuk mencegah serangan memory exhaustion.
- Pengujian E2E wajib memverifikasi handshake, room authorization (IDOR check), pemutusan instan revocation via Redis, dan heartbeat teardown.
