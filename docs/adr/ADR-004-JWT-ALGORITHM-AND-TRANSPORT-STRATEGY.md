# ADR-004: JWT Signing Algorithm, Token Lifecycle & Transport Security Strategy

- **Status:** ACCEPTED (Phase 2 Hardened Baseline)
- **Deciders:** BE Lead, Security Lead, Data Architect
- **Date:** 2026-09-02
- **Technical Context:** Modular Monolith NestJS, Node.js 22 LTS, Redis 7, VPS Staging 2 vCPU / 2 GB RAM.

---

## 1. Context & Problem Statement

Sistem Distribution Management System membutuhkan mekanisme autentikasi dan otorisasi terdesentralisasi berbasis token untuk:
1. **Mobile Apps (Owner & Driver):** Autentikasi stateless via Authorization Bearer token header.
2. **Admin Web:** Autentikasi web browser dengan proteksi berlapis terhadap XSS dan CSRF.
3. **Realtime WebSocket Gateway:** Handshake otorisasi koneksi realtime dan pemutusan instan.
4. **Token Lifecycle & Revocation:** Access token 15 menit, refresh token rotasi (7 hari), deteksi reuse token, rotasi secret key bertahap, dan invalidasi instan tanpa overhead query database berat pada setiap request.

---

## 2. Decision & Architecture Rules

### 2.1 Pilihan Algoritma: **HS256 dengan Strict Secret Policy & Key ID Rotation**
1. **Algoritma Terpilih:** **`HS256`** dengan kunci minimal 256-bit (32+ karakter acak) dimuat via environment variable `JWT_SECRET_OR_KEY`.
2. **Strict Algorithm Allowlist:** Verifikator JWT secara eksplisit mengunci `algorithms: ['HS256']` untuk mencegah serangan *algorithm substitution* (`alg: none` atau confusion RSA public key as HMAC secret).
3. **Key ID (`kid`) & Key Rotation Protocol:**
   - JWT Header menyertakan `kid` (contoh: `dms-2026-q3`).
   - Sistem mendukung `JWT_SECRET_KEY_CURRENT` (untuk signing & verifying) dan `JWT_SECRET_KEY_PREVIOUS` (untuk verifying selama grace period 24 jam).
   - Setelah masa grace period 24 jam, previous key dipensiunkan (retired).

### 2.2 Dual Transport Strategy & CSRF Defense-in-Depth
1. **Mobile Apps (Owner & Driver):**
   - **Access Token:** Dikirim via HTTP Header `Authorization: Bearer <token>`.
   - **Refresh Token:** Dikembalikan dalam JSON response body dan disimpan di Android Keystore / iOS Keychain (secure storage). Tidak pernah ditaruh di URL atau dicatat di log. Server hanya menyimpan SHA-256 hash (`refresh_token_hash`).
2. **Admin Web (Browser Client):**
   - **Access Token:** Disimpan strictly di **In-Memory JavaScript State** (tidak pernah ditulis ke `localStorage` atau `sessionStorage` untuk mitigasi XSS token theft).
   - **Refresh Token:** Dikirim melalui **`HttpOnly; Secure; SameSite=Strict; Path=/v1/auth` Cookie**.
   - **CSRF Defense-in-Depth (Bukan hanya X-Requested-With):**
     - Endpoint `/v1/auth/csrf` menerbitkan CSRF token bertanda tangan / random UUID.
     - Web mutation requests (`/v1/auth/refresh`, `/v1/auth/logout`) memvalidasi `x-csrf-token` header, cookie `SameSite=Strict`, dan `Origin`/`Referer` header against allowlist `CORS_ALLOWED_ORIGINS`.

### 2.3 Instant Token Revocation & Role Mutation Invalidation (Hybrid Redis Strategy)
1. **Performance / Security Trade-Off:**
   - Memverifikasi session ke PostgreSQL pada setiap request HTTP menimbulkan overhead database (~5-10ms per request).
   - Menggunakan pure stateless JWT membiarkan token yang di-revoke tetap hidup selama 15 menit.
   - **Keputusan:** Menggunakan **Hybrid Redis Revocation Cache**:
     - JWT diverifikasi secara kriptografis secara lokal (<0.1ms).
     - Saat user di-disable, role diubah, atau session/device di-revoke: Backend menulis key `revoked:session:<sessionId>` atau `revoked:user:<userId>` ke Redis dengan TTL 15 menit.
     - `JwtAuthGuard` memeriksa Redis `EXISTS revoked:session:<sessionId>` (<0.5ms memory check). Jika key ada $\rightarrow$ reject `401 Unauthorized` (`SESSION_REVOKED` / `ROLE_UPDATED_REAUTH_REQUIRED`).

### 2.4 Driver Single Active Session Concurrency Guard
- Driver operational session ditegakkan secara atomik menggunakan PostgreSQL transaction dengan pessimistic row locking (`SELECT id FROM users WHERE id = $1 FOR UPDATE`).
- Ini menjamin bahwa jika ada 2 login konkuren dari Driver yang sama pada 2 device berbeda, tepat 1 session aktif yang bertahan dan device lama di-revoke tanpa race condition.

### 2.5 Credential Recovery Scope
- Self-service password reset (via email/SMS OTP) secara eksplisit **DITUNDA ke Phase 11 / Post-MVP**.
- Phase 2 MVP menyediakan flow reset password yang diinisiasi oleh Admin (`POST /v1/users/:id/reset-password`).

---

## 3. Consequences & Governance
- Secret key wajib diproteksi dan tidak boleh di-hardcode ke git.
- Penamaan token dalam dokumentasi dan audit log harus menggunakan istilah **Signed JWT**, bukan "Encrypted JWT".
- Log data selalu disanitasi menggunakan `sanitizeLogData` untuk mencegah kebocoran token.
