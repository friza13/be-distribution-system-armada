# Phase 2: Authentication, Authorization, Device Session & Key Management — Design Spec

**Document Version:** 1.1.0 (Hardened & Audited Baseline)  
**Target Milestone:** Phase 2 Implementation Ready  
**Date:** 2026-09-02  
**Author:** AI Engineering Agent (BE & Security Lead)

---

## 1. Executive Summary & Goals

Phase 2 membangun sistem autentikasi end-to-end, keamanan kredensial, otorisasi berbasis peran (RBAC) dengan pencegahan IDOR/BOLA, manajemen siklus hidup perangkat & sesi, serta fondasi infrastruktur kunci publik E2EE (*prekey bundle management*). Dokumen v1.1.0 ini mengintegrasikan proteksi konkurensi tingkat transaksi, defense-in-depth CSRF untuk Admin Web, hybrid Redis revocation cache, dan protokol rotasi kunci JWT.

### Core Objectives of Phase 2:
1. **Credential Security (`SEC-AUTH-001`):** Hashing kata sandi menggunakan **Argon2id** berstandar OWASP dengan proteksi *timing enumeration* dan mekanisme *transparent parameter rehash*.
2. **JWT Architecture & Dual Transport (`SEC-AUTH-001` / `ADR-004`):** Penandatanganan JWT dengan **HS256** (strict algorithm allowlist), masa berlaku 15 menit, dual transport (Authorization Bearer untuk Mobile; in-memory access token + `HttpOnly; Secure; SameSite=Strict` cookie untuk Admin Web).
3. **Defense-in-Depth CSRF:** Validasi `Origin`/`Referer` allowlist + Double Submit CSRF token (`x-csrf-token`) + `SameSite=Strict` cookie.
4. **Session Lifecycle & Single Active Driver Concurrency (`SEC-AUTH-003`):** Manajemen refresh token dengan *token family*, rotasi single-use, deteksi replay reuse token, serta penegakan *Single Active Session* khusus untuk Driver Mobile dengan transaksi database `SELECT FOR UPDATE`.
5. **Account & Device Lifecycle with Hybrid Redis Revocation:** Penegakan status akun (`PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED`, `DISABLED`), pendaftaran/pencabutan perangkat, dan pembatalan instan token/sesi via Redis Revocation Cache (<0.5ms) serta pemutusan WebSocket via Redis PubSub (<1 detik).
6. **RBAC & Object-Level Authorization (`SEC-AUTH-002`):** Penegakan `@Roles()` dan `@RequirePermissions()` pada Guard, validasi kepemilikan data (IDOR/BOLA defense), dan penanganan mutasi role yang menginvalidasi token lama.
7. **E2EE Prekey Infrastructure Foundation (`SEC-E2EE-001`):** Endpoint registrasi kunci publik identitas perangkat dengan object-level authorization (`device.userId === req.user.id`), upload batch one-time prekeys, reservasi prekey atomik `FOR UPDATE SKIP LOCKED`, dan monitoring penipisan prekey (*depletion alert*).

---

## 2. Password Security & Credential Protection

### 2.1 Hashing Algorithm & Parameters
- **Algoritma:** **Argon2id** (OWASP recommended standard, tahan terhadap GPU, ASIC, dan side-channel).
- **Library:** `@node-rs/argon2` (Rust-based native binding, zero memory leak).
- **Parameter Baseline (VPS 2 vCPU / 2 GB RAM):**
  - `memoryCost`: 65536 KB (64 MB)
  - `timeCost`: 3 iterations
  - `parallelism`: 4 threads
  - `outputLen`: 32 bytes
- **Benchmark Target:** Latensi hashing berada pada rentang **100 ms – 250 ms** per verifikasi kredensial pada environment target.

### 2.2 User Enumeration & Timing Equalization Defense
- Pada endpoint login (`POST /v1/auth/login`), jika `username` tidak ditemukan di database:
  - Backend mengeksekusi *dummy hash verification* terhadap hash tiruan yang valid untuk menyamakan waktu respons (~150ms).
  - Pesan kegagalan selalu seragam: `"Invalid username or password"`.
  - HTTP Status Code: `401 Unauthorized` dengan error code `INVALID_CREDENTIALS`.

### 2.3 Transparent Rehash Upgrade
- Saat user berhasil login, service memeriksa `argon2.needsRehash(user.passwordHash, currentOptions)`.
- Jika parameter sistem dinaikkan di masa depan, password langsung di-hash ulang dan disimpan ke DB secara transparan tanpa meminta user mengganti password.

### 2.4 Credential Recovery Scope (Explicit Decision)
- **Self-Service Password Reset (via email/SMS OTP):** Secara eksplisit **DITUNDA ke Phase 11 / Post-MVP**.
- **Phase 2 MVP Scope:** Menyediakan flow reset password yang diinisiasi oleh Admin (`POST /v1/users/:id/reset-password`).

---

## 3. JWT Token Architecture & Key Rotation

### 3.1 Token Claims & Strict Validation
- **Algorithm:** `HS256` (Strict allowlist: `algorithms: ['HS256']`).
- **Access Token Expiration:** **15 menit** (`15m`).
- **Refresh Token Expiration:** **7 hari** (`7d`).
- **Payload Schema:**
  ```json
  {
    "sub": "b8a34f89-8d7e-4a61-9c60-84a92c304d91",
    "role": "DRIVER",
    "deviceId": "550e8400-e29b-41d4-a716-446655440000",
    "sessionId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "type": "ACCESS_TOKEN",
    "iss": "dms-api",
    "aud": "dms-clients",
    "iat": 1788349200,
    "nbf": 1788349200,
    "exp": 1788350100
  }
  ```

### 3.2 JWT Key Rotation Protocol
- **Environment Variables:**
  - `JWT_CURRENT_KEY_ID`: e.g. `"dms-2026-q3"`
  - `JWT_SECRET_OR_KEY`: Current signing & verification secret (min 32 bytes)
  - `JWT_PREVIOUS_KEY_ID`: e.g. `"dms-2026-q2"` (optional during rotation)
  - `JWT_PREVIOUS_SECRET_OR_KEY`: Previous verification secret (optional during rotation)
- **Rotation Lifecycle:**
  1. *Signing:* Selalu menggunakan `JWT_CURRENT_KEY_ID`.
  2. *Verification:* Memeriksa header `kid`. Jika `kid === JWT_PREVIOUS_KEY_ID`, token diverifikasi dengan key lama (grace period = 24 jam).
  3. *Retirement:* Setelah grace period 24 jam, key lama dihapus dari konfigurasi.

---

## 4. Dual Transport Strategy & Defense-in-Depth CSRF

### 4.1 Mobile Transport Invariants
1. **Access Token:** Dikirim via HTTP Header `Authorization: Bearer <token>`.
2. **Refresh Token:** Dikembalikan di response body dan disimpan di **Android Keystore** (via `EncryptedSharedPreferences`) / **iOS Keychain**.
3. **Security Invariants:**
   - HTTPS-only transport.
   - Refresh token **tidak pernah ditaruh di URL query parameter**.
   - Refresh token **tidak pernah dicatat di log plain text** (`sanitizeLogData` redaction).
   - Server hanya menyimpan SHA-256 hash (`refresh_token_hash`).

### 4.2 Admin Web Transport & CSRF Defense-in-Depth
1. **Access Token:** Disimpan strictly di **In-Memory JavaScript State** (tidak pernah ditulis ke `localStorage` atau `sessionStorage` untuk mitigasi XSS).
2. **Refresh Token:** Disimpan dalam cookie:
   `Set-Cookie: dms_refresh_token=<token>; HttpOnly; Secure; SameSite=Strict; Path=/v1/auth; Max-Age=604800`
3. **Defense-in-Depth CSRF Controls:**
   - **Double Submit CSRF Token:** Endpoint `GET /v1/auth/csrf` menerbitkan CSRF token ke cookie `dms_csrf_token`. Web client wajib mengirimkan header `x-csrf-token` yang nilainya cocok pada request mutasi (`/v1/auth/refresh`, `/v1/auth/logout`).
   - **Strict Origin & Referer Check:** Backend memvalidasi header `Origin` / `Referer` terhadap allowlist `CORS_ALLOWED_ORIGINS`.
   - **SameSite=Strict Cookie:** Mencegah browser mengirim cookie pada cross-site navigation/POST.

---

## 5. Session Lifecycle, Token Family & Concurrency Policy

### 5.1 Refresh Token Rotation & Reuse Detection
1. Refresh token berupa cryptographically random string (64 bytes hex), di-hash dengan SHA-256 (`refresh_token_hash`) sebelum disimpan pada tabel `sessions`.
2. Saat `/v1/auth/refresh` dipanggil:
   - Jika refresh token cocok: Dibuat session baru dengan `token_family` yang sama, session lama ditandai `is_revoked = true`.
   - **Reuse Detection:** Jika refresh token yang sudah `is_revoked = true` dikirim ulang $\rightarrow$ Backend langsung membatalkan **seluruh session dalam token_family tersebut** (`UPDATE sessions SET is_revoked = TRUE WHERE token_family = $1;`) dan mencatat audit alert `TOKEN_REUSE_DETECTED`.

### 5.2 Driver Single Active Session Concurrency Guard
- **Problem:** Dua request login paralel untuk Driver yang sama pada Device A dan Device B dapat menghasilkan 2 active session jika tidak terkoordinasi.
- **Pessimistic Concurrency Locking:**
  ```typescript
  await prisma.$transaction(async (tx) => {
    // Lock driver/user record during login to serialize concurrent requests
    await tx.$executeRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE;`;
    
    // Revoke all existing active sessions
    await tx.session.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });

    // Create single active session
    return tx.session.create({ data: { userId, deviceId, ... } });
  });
  ```
- **Owner & Admin Policy:** Diizinkan maksimal **5 concurrent active sessions** dengan penggusuran FIFO session terlama jika melebihi kuota.

---

## 6. Hybrid Redis Revocation & Account Invalidation

### 6.1 Performance vs Security Trade-Off
- **Keputusan:** Menggunakan **Hybrid Redis Revocation Cache**:
  - JWT diverifikasi secara lokal (<0.1ms).
  - Saat user di-disable, role diubah, atau session di-revoke: Backend menulis key `revoked:session:<sessionId>` atau `revoked:user:<userId>` ke Redis dengan TTL 15 menit.
  - `JwtAuthGuard` memeriksa Redis `EXISTS revoked:session:<sessionId>` (<0.5ms memory check).
  - Jika Redis key ditemukan $\rightarrow$ Reject `401 Unauthorized` (`SESSION_REVOKED`).
  - Jika Redis tidak tersedia $\rightarrow$ Fallback query ke PostgreSQL (fail-safe).

### 6.2 Role / Permission Mutation Invalidation
- Saat Admin mengubah role user (`PATCH /v1/users/:id/role`):
  1. Update DB `users.roleId`.
  2. Revoke seluruh active session di DB.
  3. Tulis Redis key `revoked:user:<userId>` (TTL 15m).
  4. Access token lama yang membawa klaim role lama langsung ditolak oleh `JwtAuthGuard` dengan `401 Unauthorized` (`ROLE_UPDATED_REAUTH_REQUIRED`).

---

## 7. RBAC & Object-Level Authorization (IDOR/BOLA Defense)

### 7.1 Role & Permission Matrix

| Permission Code | SUPER_ADMIN | ADMIN | OWNER | DRIVER |
|---|:---:|:---:|:---:|:---:|
| `user:manage` | ✓ | ✓ | ✗ | ✗ |
| `vehicle:manage` | ✓ | ✓ | ✗ | ✗ |
| `delivery:create` | ✓ | ✓ | ✓ | ✗ |
| `delivery:assign` | ✓ | ✓ | ✗ | ✗ |
| `delivery:read_all` | ✓ | ✓ | ✓ | ✗ |
| `delivery:read_assigned` | ✓ | ✓ | ✓ | ✓ |
| `delivery:update_status` | ✓ | ✓ | ✗ | ✓ |
| `location:read_all` | ✓ | ✓ | ✓ | ✗ |
| `location:write` | ✗ | ✗ | ✗ | ✓ |
| `pod:submit` | ✗ | ✗ | ✗ | ✓ |
| `e2ee:keys_manage` | ✗ | ✗ | ✓ | ✓ |
| `audit:read` | ✓ | ✓ | ✗ | ✗ |

### 7.2 Object-Level IDOR / BOLA Defense
- Driver mengakses `/v1/deliveries/:id`: Service memverifikasi `delivery.driverId === req.user.driverId`.
- Driver mengupload prekeys `/v1/e2ee/keys/prekeys`: Service memverifikasi `device.userId === req.user.id`.
- Percobaan akses cross-driver / cross-device ditolak `403 Forbidden` (`RESOURCE_ACCESS_DENIED`).

---

## 8. E2EE Prekey Infrastructure & Privacy Boundaries

### 8.1 Schema & Endpoints
1. `POST /v1/e2ee/keys/register`: Registrasi identity key & signed prekey (`device_keys`).
2. `POST /v1/e2ee/keys/prekeys`: Upload batch 50-100 one-time prekeys (`prekeys` table).
3. `GET /v1/e2ee/keys/bundle/:deviceId`:
   - Mengambil prekey bundle dan mengonsumsi 1 one-time prekey secara atomik via `SELECT FOR UPDATE SKIP LOCKED`.
   - **Privacy Boundary:** Response hanya berisi materi kriptografis publik (`identityKeyPublic`, `signedPrekeyPublic`, `signedPrekeySig`, `oneTimePrekey`). Zero sensitive user details / tokens dibocorkan.
4. `GET /v1/e2ee/keys/status`: Memeriksa jumlah prekey aktif (`count < 20` memicu status `DEPLETED_WARNING`).

---

## 9. Rate Limiting (Two-Dimensional Throttling)

- **Account-Level Throttling:** Maksimal **5 failed login attempts per 5 menit** per `username` (mencegah brute-force targeted).
- **IP-Level Throttling:** Maksimal **30 login attempts per 5 menit** per `IP` (mencegah blanket lockout pada shared NAT / corporate Wi-Fi).
- `POST /v1/auth/refresh`: Maksimal **20 request per menit** per IP.
- `GET /v1/e2ee/keys/bundle/:id`: Maksimal **30 request per menit** per user.

---

## 10. Verification & Automated Test Matrix

| Test Suite | File | Skenario Uji Kunci |
|---|---|---|
| **Password Security** | `test/auth/password-security.e2e-spec.ts` | Argon2id hashing, verifikasi kredensial, timing equalization pada non-existent user. |
| **JWT Lifecycle & Rotation** | `test/auth/jwt-lifecycle.e2e-spec.ts` | Claims payload, expiration 15m, penolakan `alg: none` / key lama setelah grace period. |
| **Session & Token Family** | `test/auth/session-rotation.e2e-spec.ts` | Single-use rotation, reuse detection membatalkan seluruh token family, logout & logout-all. |
| **Admin Web Cookie & CSRF** | `test/auth/admin-web-cookie.e2e-spec.ts` | `Set-Cookie` HttpOnly, SameSite=Strict, validasi `x-csrf-token` & Origin check (positive & negative test). |
| **Device Lifecycle & Concurrency** | `test/auth/device-lifecycle.e2e-spec.ts` | Registrasi & pencabutan device, 2 login paralel Driver menghasilkan tepat 1 active session (`SELECT FOR UPDATE`). |
| **Account Lifecycle & Revocation** | `test/auth/account-lifecycle.e2e-spec.ts` | Penolakan login akun PENDING/SUSPENDED/DISABLED, instant revocation via Redis saat role/status berubah. |
| **RBAC & IDOR Defense** | `test/auth/rbac-guards.e2e-spec.ts` | Role & permission rejection, penolakan Driver A mengakses Delivery Driver B (403). |
| **E2EE Prekey Infrastructure** | `test/auth/e2ee-key-bundle.e2e-spec.ts` | Registrasi kunci publik, upload 20 prekeys, reservasi atomik 5 request konkuren (`FOR UPDATE SKIP LOCKED`), alert prekey < 20, zero private metadata leak. |
