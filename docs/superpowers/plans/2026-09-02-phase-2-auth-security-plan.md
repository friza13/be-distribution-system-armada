# Phase 2: Authentication, Authorization, Device Session & Key Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun sistem autentikasi aman (Argon2id + JWT HS256 dengan rotasi key ID), dual transport (Mobile Bearer + Web HttpOnly Cookie & Double Submit CSRF Token), session management dengan token family reuse detection, penegakan single active driver session berbasis database transaction lock (`SELECT FOR UPDATE`), hybrid Redis revocation cache (<0.5ms), RBAC dengan proteksi IDOR/BOLA, fondasi E2EE prekey bundle atomik, dan two-dimensional rate limiting di NestJS backend.

**Architecture:** NestJS Auth Module dengan `@nestjs/jwt`, `@node-rs/argon2`, `@nestjs/passport`, Passport-JWT Strategy, cookie-parser, Redis-backed Throttler & Revocation Cache, Prisma Service, dan Custom Guards.

**Tech Stack:** Node.js 22 LTS, NestJS 10, Prisma 5.22.0, PostgreSQL 16 + PostGIS 3.4, Redis 7, `@node-rs/argon2`, `@nestjs/jwt`, `@nestjs/throttler`, `ioredis`.

---

## Global Constraints

- **Password Hashing:** Argon2id (`memoryCost: 65536`, `timeCost: 3`, `parallelism: 4`)
- **JWT Signing:** `HS256` dengan strict algorithm allowlist (`algorithms: ['HS256']`), key rotation support via `kid`, dan `15m` access expiration
- **Session Policy:** Single active session for Driver (`SELECT FOR UPDATE` locking); max 5 concurrent sessions for Admin/Owner
- **Dual Transport & CSRF:** Authorization Bearer for Mobile; HttpOnly Secure Cookie + Double Submit CSRF Token (`x-csrf-token`) + Origin validation for Admin Web
- **Token Revocation:** Hybrid Redis Cache (`revoked:session:<id>`, `revoked:user:<id>`) with fallback to DB
- **Zero Plaintext Secrets:** Passwords, tokens, and private keys never logged in plain text

---

## File Structure Map

```text
backend/
├── src/
│   ├── common/
│   │   ├── decorators/
│   │   │   ├── roles.decorator.ts
│   │   │   ├── permissions.decorator.ts
│   │   │   └── current-user.decorator.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── roles.guard.ts
│   │   │   ├── permissions.guard.ts
│   │   │   └── csrf.guard.ts
│   │   ├── utils/
│   │   │   ├── password.util.ts
│   │   │   └── token.util.ts
│   │   └── redis/
│   │       ├── redis.service.ts
│   │       └── redis.module.ts
│   └── modules/
│       ├── auth/
│       │   ├── dto/
│       │   │   ├── login.dto.ts
│       │   │   ├── refresh-token.dto.ts
│       │   │   └── register-user.dto.ts
│       │   ├── strategies/
│       │   │   └── jwt.strategy.ts
│       │   ├── auth.controller.ts
│       │   ├── auth.service.ts
│       │   └── auth.module.ts
│       ├── sessions/
│       │   ├── session.service.ts
│       │   └── session.module.ts
│       ├── devices/
│       │   ├── dto/
│       │   │   └── register-device.dto.ts
│       │   ├── device.controller.ts
│       │   ├── device.service.ts
│       │   └── device.module.ts
│       └── e2ee-keys/
│           ├── dto/
│           │   ├── register-device-keys.dto.ts
│           │   └── upload-prekeys.dto.ts
│           ├── e2ee-keys.controller.ts
│           ├── e2ee-keys.service.ts
│           └── e2ee-keys.module.ts
├── test/
│   └── auth/
│       ├── password-security.e2e-spec.ts
│       ├── jwt-lifecycle.e2e-spec.ts
│       ├── session-rotation.e2e-spec.ts
│       ├── admin-web-cookie.e2e-spec.ts
│       ├── device-lifecycle.e2e-spec.ts
│       ├── account-lifecycle.e2e-spec.ts
│       ├── rbac-guards.e2e-spec.ts
│       └── e2ee-key-bundle.e2e-spec.ts
└── package.json
```

---

## Task Breakdown & Bite-Sized Steps

---

### Task 2.1: Password Security & Argon2id Hashing Engine (`SEC-AUTH-001`)

**Files:**
- Modify: `backend/package.json` (add `@node-rs/argon2`)
- Create: `backend/src/common/utils/password.util.ts`
- Create: `backend/test/auth/password-security.e2e-spec.ts`

- [ ] **Step 1: Install `@node-rs/argon2`**

Run: `cd backend && npm install @node-rs/argon2`

- [ ] **Step 2: Implementasikan `password.util.ts`**

Fitur:
- `hashPassword(password: string): Promise<string>` menggunakan Argon2id (`memoryCost: 65536`, `timeCost: 3`, `parallelism: 4`).
- `verifyPassword(password: string, hash: string): Promise<boolean>`.
- `dummyVerifyPassword(): Promise<void>` untuk penyamarataan timing (timing equalization defense).
- `needsRehash(hash: string): boolean`.

- [ ] **Step 3: Tulis Unit & E2E Test Password Security**

Buat `test/auth/password-security.e2e-spec.ts`:
- Verifikasi hash generation & verification.
- Verifikasi rejection password salah.
- Verifikasi penyamarataan timing saat user tidak ditemukan.

---

### Task 2.2: JWT Engine, Token Strategy, Key Rotation & Dual Transport (`SEC-AUTH-001` / `ADR-004`)

**Files:**
- Modify: `backend/package.json` (add `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `cookie-parser`, `ioredis`, `@types/cookie-parser`, `@types/passport-jwt`, `@types/ioredis`)
- Create: `backend/src/common/redis/redis.service.ts`
- Create: `backend/src/common/redis/redis.module.ts`
- Create: `backend/src/common/guards/csrf.guard.ts`
- Create: `backend/src/modules/auth/dto/login.dto.ts`
- Create: `backend/src/modules/auth/dto/refresh-token.dto.ts`
- Create: `backend/src/modules/auth/strategies/jwt.strategy.ts`
- Create: `backend/src/modules/auth/auth.service.ts`
- Create: `backend/src/modules/auth/auth.controller.ts`
- Create: `backend/src/modules/auth/auth.module.ts`
- Create: `backend/test/auth/jwt-lifecycle.e2e-spec.ts`
- Create: `backend/test/auth/admin-web-cookie.e2e-spec.ts`

- [ ] **Step 1: Install dependencies JWT, Passport, Cookie-Parser, IORedis**

Run: `cd backend && npm install @nestjs/jwt @nestjs/passport passport passport-jwt cookie-parser ioredis && npm install -D @types/cookie-parser @types/passport-jwt`

- [ ] **Step 2: Implementasikan RedisService & RedisModule**
  - Mengelola koneksi ke Redis untuk revocation cache dan pubsub.
  - Method: `isRevoked(key: string): Promise<boolean>`, `setRevocation(key: string, ttlSeconds: number): Promise<void>`.

- [ ] **Step 3: Implementasikan AuthService & Key Rotation**
  - `login(dto, clientType, req, res)`:
    - Verifikasi kredensial. Jika gagal $\rightarrow$ `dummyVerifyPassword()` + throw `401`.
    - Buat session di DB dengan `tokenFamily` dan `refreshTokenHash`.
    - Generate JWT dengan `kid` header bertanda tangan `HS256`.
    - Jika clientType === `WEB` $\rightarrow$ Set `dms_refresh_token` HttpOnly cookie + generate CSRF cookie `dms_csrf_token`.
    - Jika clientType === `MOBILE` $\rightarrow$ Return JSON body with raw `refreshToken`.

- [ ] **Step 4: Implementasikan CsrfGuard & AuthController**
  - `GET /v1/auth/csrf`: Menerbitkan token CSRF.
  - `POST /v1/auth/login`
  - `POST /v1/auth/refresh`
  - `POST /v1/auth/logout`
  - `POST /v1/auth/logout-all`

- [ ] **Step 5: Tulis E2E Tests JWT Lifecycle, Key Rotation & Admin Web CSRF**
  - Validasi claims, expiration 15m, dan key rotation fallback via `kid`.
  - Validasi CSRF rejection jika header `x-csrf-token` hilang atau origin tidak valid.

---

### Task 2.3: Session Management, Token Family & Single Active Driver Concurrency (`SEC-AUTH-003`)

**Files:**
- Create: `backend/src/modules/sessions/session.service.ts`
- Create: `backend/src/modules/sessions/session.module.ts`
- Create: `backend/src/modules/devices/dto/register-device.dto.ts`
- Create: `backend/src/modules/devices/device.service.ts`
- Create: `backend/src/modules/devices/device.controller.ts`
- Create: `backend/src/modules/devices/device.module.ts`
- Create: `backend/test/auth/session-rotation.e2e-spec.ts`
- Create: `backend/test/auth/device-lifecycle.e2e-spec.ts`

- [ ] **Step 1: Implementasikan SessionService & Token Family Rotation**
  - `rotateSession(oldRefreshToken, clientIp, userAgent)`:
    - Cari session aktif dengan `refresh_token_hash`.
    - Jika session ditemukan tetapi `is_revoked === true` $\rightarrow$ **Token Reuse Detected!** Revoke seluruh `token_family`, tulis Redis revocation cache, dan catat audit log `TOKEN_REUSE_DETECTED`.
    - Jika session valid $\rightarrow$ tandai session lama `is_revoked = true`, buat session baru dengan `token_family` yang sama.

- [ ] **Step 2: Implementasikan Driver Single Active Session dengan Concurrency Lock**
  - `enforceDriverSingleSession(userId, newDeviceId, tx)`:
    - Lock user row: `SELECT id FROM users WHERE id = $1 FOR UPDATE`.
    - Invalidate all existing sessions for this driver in DB and write to Redis revocation cache.
    - Create single new active session.

- [ ] **Step 3: Implementasikan DeviceService (Registration & Revoke)**
  - `registerDevice(userId, dto)`: Upsert `devices` record.
  - `revokeDevice(deviceId, currentUserId)`: Verifikasi kepemilikan device / admin permission, tandai `devices.status = REVOKED`, batalkan sessions terkait di DB & Redis.

- [ ] **Step 4: Tulis E2E Tests Session Rotation, Token Family & Concurrent Driver Login**
  - Uji single-use refresh token rotation.
  - Uji token reuse detection yang membatalkan seluruh token family.
  - Uji 2 request login paralel Driver yang menghasilkan tepat 1 active session.

---

### Task 2.4: RBAC, Permission Guard, Role Mutation & Object-Level Authorization (`SEC-AUTH-002`)

**Files:**
- Create: `backend/src/common/decorators/roles.decorator.ts`
- Create: `backend/src/common/decorators/permissions.decorator.ts`
- Create: `backend/src/common/decorators/current-user.decorator.ts`
- Create: `backend/src/common/guards/jwt-auth.guard.ts`
- Create: `backend/src/common/guards/roles.guard.ts`
- Create: `backend/src/common/guards/permissions.guard.ts`
- Create: `backend/test/auth/rbac-guards.e2e-spec.ts`
- Create: `backend/test/auth/account-lifecycle.e2e-spec.ts`

- [ ] **Step 1: Implementasikan Decorators & Guards**
  - `JwtAuthGuard`: Memverifikasi JWT, memeriksa Redis revocation cache `revoked:session:<id>` dan `revoked:user:<id>`, memastikan status user `ACTIVE`.
  - `RolesGuard`: Memeriksa `@Roles()` against `req.user.role`.
  - `PermissionsGuard`: Memeriksa `@RequirePermissions()` against permissions user.

- [ ] **Step 2: Implementasikan Role Mutation Invalidation**
  - Saat role user diubah $\rightarrow$ Service menulis Redis revocation key `revoked:user:<userId>` (TTL 15m) $\rightarrow$ `JwtAuthGuard` menolak token lama yang membawa klaim role lama.

- [ ] **Step 3: Implementasikan Object-Level Authorization (IDOR Defense)**
  - Driver hanya boleh mengakses Delivery dan Location Point miliknya sendiri.

- [ ] **Step 4: Tulis E2E Tests RBAC, Account Lifecycle & Role Mutation**
  - Uji akses role yang diizinkan vs ditolak.
  - Uji penolakan login akun PENDING/SUSPENDED/DISABLED.
  - Uji penolakan token lama saat role user diubah oleh Admin.

---

### Task 2.5: E2EE Device Key Registration & Prekey Infrastructure (`SEC-E2EE-001`)

**Files:**
- Create: `backend/src/modules/e2ee-keys/dto/register-device-keys.dto.ts`
- Create: `backend/src/modules/e2ee-keys/dto/upload-prekeys.dto.ts`
- Create: `backend/src/modules/e2ee-keys/e2ee-keys.service.ts`
- Create: `backend/src/modules/e2ee-keys/e2ee-keys.controller.ts`
- Create: `backend/src/modules/e2ee-keys/e2ee-keys.module.ts`
- Create: `backend/test/auth/e2ee-key-bundle.e2e-spec.ts`

- [ ] **Step 1: Implementasikan DTOs, Object Ownership & E2eeKeysService**
  - `registerDeviceKeys(deviceId, dto, reqUser)`: Verifikasi `device.userId === reqUser.id`, upsert `device_keys`.
  - `uploadPrekeys(deviceId, prekeysArray, reqUser)`: Verifikasi `device.userId === reqUser.id`, insert batch ke `prekeys`.
  - `consumePrekeyBundle(targetDeviceId)`:
    - Ambil public keys dari `device_keys`.
    - Konsumsi 1 one-time prekey via `SELECT FOR UPDATE SKIP LOCKED` pada `prekeys`.
    - Return public bundle (zero sensitive user metadata leak).
  - `getPrekeyStatus(deviceId)`: Hitung sisa prekey (`count < 20` return flag `depleted: true`).

- [ ] **Step 2: Tulis E2E Test E2EE Prekey Infrastructure**
  - Uji registrasi key & upload 20 prekeys.
  - Uji penolakan upload prekey untuk device milik user lain (`403 Forbidden`).
  - Uji konsumsi atomik 5 request konkuren (`FOR UPDATE SKIP LOCKED`).
  - Uji status peringatan penipisan prekey.

---

### Task 2.6: Rate Limiting & Security Audit Logging Integration

**Files:**
- Modify: `backend/package.json` (add `@nestjs/throttler`)
- Modify: `backend/src/app.module.ts` (configure ThrottlerModule)
- Create: `backend/src/common/guards/auth-throttler.guard.ts`
- Modify: `backend/src/modules/auth/auth.service.ts` (record audit logs via Prisma `audit_logs`)

- [ ] **Step 1: Install `@nestjs/throttler` & Configure Two-Dimensional Throttling**
  - Account-level limit: 5 failed attempts per 5 minutes per `username`.
  - IP-level limit: 30 attempts per 5 minutes per `IP`.

- [ ] **Step 2: Integrate Audit Logging across Auth Operations**
  - Simpan audit log pada `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `TOKEN_REUSE_DETECTED`, `DEVICE_REVOKED`, `ACCOUNT_DISABLED`.

- [ ] **Step 3: Execute Full Phase 2 Test Suite & Build Verification**
  Commands:
  ```bash
  cd backend && npm run test && npm run test:e2e && npm run build
  ```
  Expected: All test suites PASS (100% green).

---

## Verification Plan

### Automated Tests
- `npm run test` (Unit tests: password benchmark, JWT claims, prekey depletion)
- `npm run test:e2e` (E2E tests: password security, jwt lifecycle, session rotation, admin web cookie, device lifecycle, account lifecycle, rbac guards, e2ee key bundle)
- `npm run build` (Clean production build)

### Manual Verification
1. Login via curl dengan mobile header: verify JSON refresh token returned.
2. Login via curl dengan web header: verify `Set-Cookie: dms_refresh_token=...; HttpOnly; SameSite=Strict` and `x-csrf-token` header requirement.
3. Test brute-force login: verify account throttling triggers HTTP 429 without blocking whole IP.
4. Inspect `audit_logs`: verify zero passwords or tokens present in `before_json` / `after_json`.
