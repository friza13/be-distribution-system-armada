# Phase 0: Foundation, Arsitektur Modul & Resource Limits — Design Spec

**Document Version:** 1.1.0 (Hardened & Reconciled Baseline)  
**Target Milestone:** Phase 0 Implementation Ready  
**Date:** 2026-09-02  
**Author:** AI Engineering Agent (BE & Security Lead)

---

## 1. Executive Summary & Goals

Phase 0 menetapkan fondasi teknis, arsitektur modul, standardisasi response, perlindungan perimeter dasar (request size limits, DTO whitelisting), serta evaluasi engine database access (ORM Selection Spike ADR-001) sebelum skema database PostGIS dan modul domain diimplementasikan pada fase berikutnya.

### Core Objectives of Phase 0:
1. **Repository & Scaffold Inisialisasi (`BE-CORE-001`):** Setup backend NestJS berbasis **Node.js 22 LTS** (`Active LTS`, strict TypeScript `strictNullChecks`, `noImplicitAny`, path aliases, modular monolith layout).
2. **Standard API Envelope & Observability Trace (`BE-CORE-002`):** Standardisasi response envelope (`{ success, data, error, timestamp, requestId }`), Global Exception Filter dengan **log sanitization** (mencegah kebocoran password, token, authorization, database credentials), dan Correlation ID Middleware (`x-request-id`) dengan **validasi format UUID ketat**.
3. **ORM & PostGIS Access Spike (`BE-CORE-003`):** Evaluasi empiris di folder `spikes/orm/` antara **Prisma** (dengan PostGIS raw SQL `$queryRaw`) vs **Drizzle ORM** vs **TypeORM**, menghasilkan dokumen keputusan `docs/adr/ADR-001-ORM-SELECTION.md` dengan siklus hidup status yang jelas (**PROPOSED** $\rightarrow$ **ACCEPTED** setelah spike selesai).
4. **Perimeter Hardening & Anti Mass-Assignment (`BE-CORE-004`):** Konfigurasi global NestJS `ValidationPipe` (`whitelist: true`, `forbidNonWhitelisted: true`), JSON body size limit (100 KB), DTO string/array bounds, dan standard pagination guards (`@Max(100)`).
5. **Local Development Infrastructure:** Menyiapkan `docker-compose.yml` lokal untuk PostgreSQL 16 + PostGIS 3.4 (`postgis/postgis:16-3.4-alpine`) dan Redis 7 (`redis:7-alpine`) dengan **zero plaintext credentials** (menggunakan environment variable substitution `${POSTGRES_PASSWORD}`).

---

## 2. Global Constraints & Standardized Naming

- **Node.js Runtime Baseline:** `Node.js 22 LTS (Active LTS)` (versi runtime seragam di Dockerfile, CI, dan package engine).
- **Package Manager:** `npm` (dengan lockfile `package-lock.json`).
- **Global API Prefix:** `v1` (semua route berada di bawah `/v1/*`).
- **Secret Policy:** Zero plaintext secrets in Git repository. Docker Compose dan aplikasi backend hanya membaca credentials via `.env` lokal yang diabaikan oleh `.gitignore`.
- **Performance Targets Formulation:** Seluruh metrik performa di Phase 0 diposisikan sebagai **Measurement Baseline Targets** yang akan diukur dan dikalibrasi secara empiris di lingkungan staging, bukan sebagai jaminan statis tanpa pengujian.

---

## 3. Architecture & Directory Layout

Sesuai dokumen baseline `04-SYSTEM-ARCHITECTURE.md` dan `TASK_BREAKDOWN_BE_SECURITY.md`, seluruh kode aplikasi backend diisolasi pada direktori `backend/`, dengan kode spike dipisahkan dari source tree domain produksi:

```text
backend/
├── src/                              # Production Application Source Code
│   ├── common/                       # Shared utilities, filters, interceptors, guards, DTOs
│   │   ├── dto/
│   │   │   ├── api-response.dto.ts   # Standard API Envelope (Zero 'any' types)
│   │   │   └── pagination.dto.ts     # Base Pagination Query DTO (limit max 100, page min 1)
│   │   ├── filters/
│   │   │   └── global-exception.filter.ts  # Central error handler with sanitized logging
│   │   ├── interceptors/
│   │   │   ├── transform.interceptor.ts    # Transforms controller return value to standard envelope
│   │   │   └── logging.interceptor.ts      # Sanitized request/response execution time logger
│   │   ├── middleware/
│   │   │   └── request-id.middleware.ts    # Hardened UUID validator & generator
│   │   └── pipes/                    # Global/custom validation pipes
│   ├── config/                       # Environment configuration & validation
│   │   ├── configuration.ts          # Contract-based config loader (JWT agnostic, DB, Redis)
│   │   └── env.validation.ts         # Joi schema validation for environment variables
│   ├── modules/                      # Domain Modules (Modular Monolith)
│   │   ├── auth/
│   │   ├── users/
│   │   ├── drivers/
│   │   ├── vehicles/
│   │   ├── deliveries/
│   │   ├── routes/
│   │   ├── tracking/
│   │   ├── communication/
│   │   ├── notifications/
│   │   ├── pod/
│   │   ├── audit/
│   │   ├── health/
│   │   └── integrations/
│   │       ├── maps/
│   │       └── realtime/
│   ├── app.module.ts
│   └── main.ts                       # Application Bootstrap with security filters, pipes, and body limits
├── spikes/                           # Isolated Spikes & Proof-of-Concept Scripts (Non-production)
│   └── orm/
│       ├── orm-evaluation.ts         # Spatial query & transaction benchmark script
│       └── README.md
├── test/                             # Unit, e2e, and contract tests
│   ├── api-envelope.e2e-spec.ts
│   ├── mass-assignment.e2e-spec.ts
│   ├── request-limits.e2e-spec.ts
│   └── jest-e2e.json
├── docs/
│   └── adr/
│       └── ADR-001-ORM-SELECTION.md  # Formal decision record (PROPOSED -> ACCEPTED)
├── .env.example                      # Sanitized template with placeholders
├── .gitignore                        # Strict secret & build ignore rules
├── docker-compose.yml                # Local PostGIS & Redis with env substitution
├── nest-cli.json
├── package.json
└── tsconfig.json
```

---

## 4. Detailed Component Specifications

### 4.1 Standard API Envelope & Type-Safe Error Model (`BE-CORE-002`)
Semua endpoint HTTP REST mengembalikan format response terstandarisasi tanpa menggunakan tipe `any`:

```typescript
// Type Definition (backend/src/common/dto/api-response.dto.ts)
export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: Record<string, unknown> | Array<unknown> | string | null;
}

export class ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorDetail | null;
  timestamp: string;
  requestId: string;
}
```

### 4.2 Hardened Request Correlation ID (`x-request-id`) Middleware
Untuk mencegah injeksi header sembarangan atau DoS via header berukuran masif:
- Middleware memeriksa header `x-request-id`.
- Nilai header divalidasi menggunakan regex UUID standar: `^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` (panjang tepat 36 karakter).
- Jika header hilang, tidak cocok format UUID, atau panjangnya melebihi 36 karakter, header tersebut dibuang dan server meng-generate **UUIDv4 baru** secara otomatis.
- Header `x-request-id` yang valid disematkan ke response header dan context logger.

### 4.3 Global Exception Filter & Log Sanitization Rules
1. **Exception Handling:**
   - `HttpException` standar NestJS: Petakan status code, ambil message dan validation error details terstruktur.
   - Unhandled Error / Database Driver Error:
     - Log internal error lengkap dengan stack trace dan `requestId` ke internal logger.
     - **Masking ke Client:** Kembalikan status HTTP 500 dengan error code `"INTERNAL_SERVER_ERROR"` dan message generic `"An internal server error occurred"`.
2. **Log Sanitization Filter:**
   - Semua payload log yang mencatat request/error wajib melewati fungsi sanitasi redaksi yang otomatis menyamarkan field:
     `password`, `passwordHash`, `authorization`, `token`, `accessToken`, `refreshToken`, `cookie`, `secret`, `key`, `privateKey`, `databaseUrl`, `postgres_password`.
   - Nilai field tersebut diganti menjadi `"[REDACTED]"` sebelum ditulis ke log output.

### 4.4 Decoupled JWT Configuration Contract
Konfigurasi JWT pada Phase 0 dipisahkan dari implementasi algoritma tertentu:
- `JWT_ALGORITHM`: string (allowlist: `['HS256', 'RS256', 'EdDSA']`, default: `HS256`).
- `JWT_SECRET_OR_KEY`: string (min 32 karakter).
- `JWT_ISSUER`: string (default: `dms-api`).
- `JWT_AUDIENCE`: string (default: `dms-clients`).
- `JWT_ACCESS_EXPIRATION`: string (default: `15m`).
- `JWT_REFRESH_EXPIRATION`: string (default: `7d`).

Keputusan akhir implementasi algoritma dikunci pada Phase 2 setelah `ADR-004-JWT-SIGNING-ALGORITHM.md` diformalkan.

### 4.5 Request Limits & Anti Mass-Assignment (`BE-CORE-004`)
1. **Global ValidationPipe:**
   ```typescript
   app.useGlobalPipes(
     new ValidationPipe({
       whitelist: true,               // Menolak / membuang property di luar DTO
       forbidNonWhitelisted: true,    // Melemparkan HTTP 400 jika ada property asing
       transform: true,               // Mengubah primitive ke target types
       transformOptions: { enableImplicitConversion: false },
     }),
   );
   ```
2. **Payload Size Bounds (Express Body Parser):**
   - JSON Body Limit: `100kb` (`express.json({ limit: '100kb' })`)
   - URL Encoded Limit: `50kb` (`express.urlencoded({ extended: true, limit: '50kb' })`)
3. **Pagination & Query Limits:**
   - `PaginationQueryDto`: `page` (default 1, min 1), `limit` (default 20, min 1, max 100 via `@Max(100)`).

### 4.6 ORM Selection Spike & Lifecycle (`BE-CORE-003` & `ADR-001`)
- **Status Lifecycle:** `PROPOSED (In Evaluation)` saat inisiasi $\rightarrow$ `ACCEPTED` setelah benchmark selesai.
- **Lokasi Kode Spike:** `backend/spikes/orm/orm-evaluation.ts` (terisolasi di luar `src/`).
- **Pengujian Spasial:**
  1. DDL migrasi PostGIS `geometry(Point, 4326)`.
  2. Batch insert 1000 koordinat.
  3. Spatial queries: `ST_DWithin`, `ST_Distance`.
  4. Pengukuran latency query dan transaksi ACID.
- **Output:** Dokumentasi lengkap dengan bukti empiris pada `docs/adr/ADR-001-ORM-SELECTION.md`.

---

## 5. Verification & Testing Strategy for Phase 0

1. **Bootstrap & Healthcheck Test:**
   - Server NestJS dapat booting dengan `npm run start:dev` dan `npm run build`.
   - `GET /v1/health/liveness` mengembalikan HTTP 200 OK dengan format standard envelope.
2. **Exception Filter & Masking Test:**
   - Endpoint simulasi unhandled error mengembalikan HTTP 500 tanpa membocorkan stack trace.
   - Endpoint simulasi DTO validation error mengembalikan HTTP 400 dengan detail field yang valid.
   - Log server tidak mengandung plaintext credentials saat terjadi error autentikasi/database.
3. **Correlation ID Hardening Test:**
   - Request dengan `x-request-id: invalid-id-123` menghasilkan UUID baru di response header.
   - Request dengan UUID valid mempertahankan UUID yang sama.
4. **Mass-Assignment & Whitelisting Test:**
   - Mengirim request dengan property asing (misal: `{ extraField: 'exploit' }`) langsung ditolak dengan HTTP 400 Bad Request (`property extraField should not exist`).
5. **Body Limit & DoS Guard Test:**
   - Mengirim payload JSON > 100 KB langsung ditolak oleh body parser dengan HTTP 413 Payload Too Large.
