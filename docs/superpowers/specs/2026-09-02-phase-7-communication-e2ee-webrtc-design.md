# Phase 7: Communication, E2EE Chat & WebRTC — Design Specification

**Document Version:** 1.0.0
**Target Milestone:** Phase 7 Complete & Verified
**Date:** 2026-09-02
**Author:** AI Engineering Agent (BE & Security Lead / Senior Software Engineer & Project Manager)

---

## 1. Executive Summary & Core Boundary

Phase 7 mengimplementasikan subsistem komunikasi realtime dua arah yang aman mencakup **1:1 E2EE Text Messaging**, **Voice Push-to-Talk (PTT) Signaling**, dan **Video Call Signaling** berbasis WebRTC dengan arsitektur berstandar tinggi.

### Cryptographic & Network Boundary Invariants
- **Client Layer (Flutter Mobile / Web):** Meng-generate keypair, menjalankan X3DH session establishment & Double Ratchet local encryption/decryption, serta mengalirkan stream audio/video WebRTC P2P via **DTLS-SRTP** (RFC 8827).
- **Backend Layer (NestJS API & Socket.IO):** Mengelola otentikasi (`JwtAuthGuard`), otorisasi room (`WsRoomAuthorizerService`), validasi skema envelope (`ciphertextBlob`, `headerJson`), menyimpan ciphertext ke tabel `messages`, dan merelay sinyal WebRTC/ciphertext via WebSocket `conversation:<id>` & `session:<id>`.
- **Zero Plaintext Invariant:** Backend **TIDAK MENGIMPLEMENTASIKAN** custom crypto, **TIDAK MENYIMPAN** private key, **TIDAK MENERIMA** plaintext, **TIDAK MENDEKRIPSI** ciphertext, dan **TIDAK MENYENTUH** byte stream media audio/video.

---

## 2. E2EE Key Management & Integration (Phase 2 Alignment)

- Memanfaatkan modul `E2eeKeysService` Phase 2 tanpa menduplikasi key management.
- Menggunakan `device_keys` (`identity_key_public`, `signed_prekey_public`, `signed_prekey_sig`) dan `prekeys` (one-time prekeys dengan reservasi atomik `SELECT FOR UPDATE SKIP LOCKED`).
- Pencabutan perangkat (`Device`) atau sesi yang kadaluarsa via `device.service.ts` / Redis blacklist secara otomatis memutus socket aktif dan menolak akses ke room percakapan.

---

## 3. Realtime Chat & WebRTC Control Plane

### 3.1 Chat Endpoints & Events
- **REST Endpoints:**
  - `POST /v1/conversations`: Membuat percakapan 1:1 antara Owner dan Driver.
  - `GET /v1/conversations`: Mengambil daftar percakapan aktif user.
  - `GET /v1/conversations/:id/messages`: Mengambil riwayat pesan ciphertext terpaginasi.
  - `POST /v1/conversations/:id/messages`: Mengirim pesan ciphertext E2EE (REST Fallback).
- **WebSocket Events (`/v1/realtime`):**
  - `chat.message.send`: Client mengirim ciphertext envelope.
  - `chat.message.relayed`: Gateway merelay ciphertext envelope ke room `conversation:<id>`.
  - `chat.message.ack`: Konfirmasi ACK status pesan (`SENT`, `DELIVERED`, `READ`).

### 3.2 WebRTC Call Session State Machine (`RealtimeSessionStatus`)

```text
PENDING (Call Invited) ────────► ACTIVE (Driver Accepted) ────────► ENDED (Call Finished)
   │
   ├─► DECLINED (Driver Declined)
   └─► TIMEOUT (No Answer in 30s)
```

- **REST Call Endpoints:**
  - `POST /v1/voice-sessions`: Inisialisasi panggilan PTT Voice & terbitkan kredensial TURN ephemeral.
  - `POST /v1/video-sessions`: Inisialisasi panggilan Video Call & terbitkan kredensial TURN ephemeral.
  - `POST /v1/realtime/sessions/:id/respond`: Driver menerima (`ACCEPT`) atau menolak (`DECLINE`) panggilan.
  - `POST /v1/realtime/sessions/:id/end`: Mengakhiri sesi panggilan (`status: ENDED`).

- **Coturn / TurnREST Ephemeral Credentials (RFC 7635):**
  - Shared secret: `TURN_SECRET`.
  - Ephemeral Username: `timestamp:userId` (TTL 3600s / 1 jam).
  - Ephemeral Password: `Base64(HMAC-SHA1(TURN_SECRET, timestamp:userId))`.
  - Dilindungi tanpa dicetak di log atau disimpan di database.

- **Driver Explicit Consent Gate:** Panggilan Video Call (`type: VIDEO`) wajib disetujui eksplisit oleh Driver via UI prompt sebelum pertukaran sinyal offer/answer WebRTC diizinkan.

---

## 4. Rate Limiting & Abuse Protection

- **Chat Rate Limit:** Maksimal **10 pesan / detik** per user (`throttle:chat:send:<userId>`).
- **Call Invite Rate Limit:** Maksimal **3 undangan / menit** per user (`throttle:call:invite:<userId>`).
- **ICE Candidate Rate Limit:** Maksimal **50 candidates** per socket session (`throttle:ice:<socketId>:<sessionId>`).
- **Frame Limit:** Mengunci ukuran maksimum **32 KB** per WebSocket frame.
