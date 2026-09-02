# TASK BREAKDOWN & EXECUTION PLAN: BACKEND & SECURITY (MASTER BASELINE)
## Distribution Management System (Capstone Project)

**Role:** BE / Backend Engineer + Security Engineer + Reviewer / Auditor  
**Document Version:** 1.2.0 (Final Corrective & Governance Baseline)  
**Target Milestone:** MVP Release Ready (Phase 0 Execution Ready)  
**Date:** 2026-08-30  
**Target Project:** Distribution Management System (Armada)

---

## 1. Ringkasan Eksekutif & Status Kesiapan

Sistem **Distribution Management System** adalah platform distribusi internal perusahaan yang mengintegrasikan tiga client surface (**Admin Web**, **Owner Mobile**, dan **Driver Mobile**) dengan satu **Backend API Modular Monolith** berbasis **NestJS, PostgreSQL + PostGIS, dan Redis**. Sistem ini berfokus pada manajemen pengiriman armada mandiri, tracking lokasi real-time dari smartphone driver (tanpa IoT kendaraan), perutean adaptif, bukti pengiriman (POD), komunikasi terproteksi (E2EE Chat & WebRTC PTT/Video), serta audit kepatuhan terpusat.

### Status Kesiapan Eksekusi:
> **STATUS: EXECUTION-READY UNTUK PHASE 0 (FOUNDATION & SETUP).**  
> Seluruh kebutuhan desain, batasan arsitektur, dan model ancaman telah disinkronkan ke dalam rencana kerja berjenjang (18 fase, 73 task). Eksekusi Phase 0 dapat dimulai segera dengan **dependency ADR (Architecture Decision Record), technical spikes, dan validation gates** yang eksplisit sebelum melangkah ke fase berikutnya.

---

## 2. Change Control & Baseline Governance

Untuk menjaga konsistensi antara dokumentasi dan implementasi sepanjang siklus pengembangan, seluruh tim wajib mematuhi aturan tata kelola perubahan (*governance rule*) berikut:

```text
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ CHANGE CONTROL GOVERNANCE WORKFLOW                                                    │
├───────────────────────────────┬───────────────────────────────────────────────────────┤
│ Jenis Perubahan               │ Dokumen yang Wajib Diperbarui                         │
├───────────────────────────────┼───────────────────────────────────────────────────────┤
│ Perubahan Scope / Requirement │ 01-PRD.md dan 02-SRS.md                               │
│ Keputusan Arsitektur / Spike  │ ADR Record (ADR-001 s/d ADR-005 di folder docs/adr/)  │
│ Perubahan Kontrak API / Event │ 06-API-REALTIME.md dan OpenAPI Specification          │
│ Kebijakan Keamanan / RBAC     │ 07-SECURITY-RBAC.md                                   │
│ Rencana Kerja & Estimasi Task │ TASK_BREAKDOWN_BE_SECURITY.md                         │
│ Alokasi Tanggung Jawab Tim    │ 10-TEAM-RESPONSIBILITY.md                             │
└───────────────────────────────┴───────────────────────────────────────────────────────┘
```

Setiap perubahan besar (*breaking changes*) pada kontrak API atau skema database wajib melalui mekanisme Pull Request Review dari lead BE dan lead Security sebelum di-merge.

---

## 3. Scope BE & Security & Architectural Baseline

### 3.1 In-Scope (Tanggung Jawab Penuh BE/Security)
1. **Arsitektur Modular Monolith NestJS:** Modul domain terisolasi, DTO whitelisting ketat (anti mass-assignment), global exception filter terpusat, correlation ID middleware (`x-request-id`), dan strict class-validator.
2. **Database & PostGIS Spasial:** Skema relasional, migrasi versi, tipe data kanonikal `geometry(Point, 4326)`, indeks GiST spasial, partitioning histori lokasi, dan integritas transaksi ACID.
3. **Autentikasi & Session Lifecycle:** Password hashing Argon2id (dengan benchmark staging), JWS (Signed JWT) berumur pendek (15m), refresh token rotatif dengan deteksi reuse token family, manajemen device session multi-perangkat, hybrid auth transport (Bearer Header untuk Mobile & Secure HttpOnly Cookie + CSRF protection untuk Admin Web), dan instant revocation bridge via Redis.
4. **RBAC & Object-Level Authorization Engine:** Penegakan dual-layer (Role Permission + Resource Ownership Scope / Anti-IDOR/BOLA) pada seluruh endpoint REST, event WebSocket, dan signaling WebRTC.
5. **Core Delivery & Transactional State Machine:** Mesin status pengiriman strictly-typed, transaction boundaries untuk dispatch/assignment, alokasi kendaraan, dan pencatatan event histori.
6. **Transactional Event Outbox:** Menjamin konsistensi database-to-realtime agar event publikasi WebSocket tidak hilang saat database commit berhasil.
7. **Geocoding & Routing Resiliency:** Provider abstraction layer (OSM/Nominatim/OSRM/Google Maps), bounded routing algorithm (`n <= 5` exhaustive permutation, `n > 5` Nearest Neighbor + 2-Opt heuristic), circuit breaker, 3s timeout, caching matriks jarak Redis, dan mitigasi DoS request path.
8. **GPS Ingestion & Telemetry Security:** Pipeline validasi telemetri smartphone (filter akurasi <50m, deteksi lompatan/outlier kecepatan >150 km/jam, clock skew rejection, server-received timestamping).
9. **Realtime WebSocket Gateway:** Autentikasi handshake WSS, room authorization per delivery/tenant, event deduplication, throttled fan-out, presence tracking, dan automated disconnect upon account revocation.
10. **Offline Outbox, Sync & Conflict Engine:** Dukungan client outbox, idempotency keys, deteksi konflik state transaksi dengan *Authority Matrix* deterministik, preservasi bukti (POD/event) ke tabel `delivery_conflicts`, dan workflow audit review.
11. **Secure File Upload & Proof of Delivery (POD):** Validasi magic bytes/MIME, isolasi storage privat (S3-compatible/MinIO), random UUID object naming, temporary pre-signed URL / authorized proxy download, dan decoupling malware scanning capability.
12. **Mobile Wake-up & Push Bridge:** State mesin pemanggilan persisten di backend, integrasi FCM/APNs untuk wake-up saat socket disconnect, push notification sebagai untrusted channel model, dan sanitasi payload lock-screen (privasi data).
13. **End-to-End Encrypted (E2EE) Messaging:** Feasibility spike pada target mobile, integrasi protokol E2EE established (Signal Protocol family / X3DH + Double Ratchet), backend relay untuk ciphertext envelope, manajemen prekey bundle, dan zero-plaintext logging policy (dengan fallback classification yang jujur).
14. **WebRTC Signaling, PTT & Video Session:** Autentikasi sesi panggilan Owner ↔ Driver, alokasi kredensial ephemeral TURN/ICE, session nonces & anti-replay protection, media authorization, dan terminasi sesi terikat timeout.
15. **Emergency SOS & Security Telemetry:** Handler prioritas tinggi untuk insiden darurat, broadcast multi-channel, deteksi anomali keamanan, dan append-only audit trail.
16. **Security Hardening & Observability:** Proteksi rate limiting bertingkat (global, auth, geocode, route), CORS strict allowlist, security headers (Helmet), audit logging terstruktur, log redaction (sanitasi token/kunci/password/payload), health checks (`@nestjs/terminus`), metrics gauge/counter, dan scanning kerentanan dependensi.
17. **Contract Testing:** Schema contract validation otomatis untuk REST dan WebSocket guna mencegah drift antara FE dan BE.
18. **Data Retention & Privacy Purge:** Kebijakan retensi otomatis untuk data lokasi, sesi kadaluarsa, token push stale, log aplikasi, dan metadata komunikasi.
19. **Encrypted Backup & Disaster Recovery:** Pipeline backup database PostgreSQL terenkripsi (AES-256), verifikasi checksum SHA-256, dan audit log otorisasi pemulihan data.

---

## 4. Key Architectural & Security Decisions

### 4.1 Keputusan Tunggal JWT Signing Algorithm (`HS256` Baseline)
Untuk backend modular monolith fase MVP, diputuskan **satu target implementasi tunggal**:
- **Algoritma Baseline:** `HS256` (HMAC dengan SHA-256) menggunakan 512-bit cryptographically secure secret yang diinjeksi via environment variables.
- **Justifikasi:** Menghindari overhead komputasi CPU dan alokasi memori asymmetric cryptography pada VPS staging 2 vCPU / 2 GB RAM di mana verifikasi token dilakukan secara internal dalam satu service monolith.
- **Governance:** `ADR-004-JWT-SIGNING-ALGORITHM.md` mendokumentasikan evaluasi terhadap `RS256`/`EdDSA`. Jika di masa depan arsitektur dipecah menjadi microservices multi-verifier, antarmuka `TokenService` siap dialihkan ke asymmetric key tanpa mengubah domain logic.

### 4.2 Target Benchmark SLA/SLO (Percentile P95 / P99)
Target performa ditetapkan sebagai **benchmark target berbasis persentil** yang akan divalidasi secara empiris di VPS staging:
- **API REST CRUD Operations:** Target P95 $\le 100\text{ ms}$, P99 $\le 250\text{ ms}$ (beban 50 req/s).
- **GPS Telemetry Ingestion (`/v1/me/location`):** Target P95 $\le 50\text{ ms}$, P99 $\le 150\text{ ms}$ (beban 100 req/s).
- **Redis State Cache Reads:** Target P95 $\le 10\text{ ms}$, P99 $\le 25\text{ ms}$.
- **WebSocket Live Map Fan-Out:** Target P95 $\le 250\text{ ms}$ end-to-end (dari ingest GPS hingga diterima viewer socket).
- **Bounded Route TSP Optimization ($n \le 25$ stops):** Target P95 $\le 500\text{ ms}$, P99 $\le 1000\text{ ms}$.
- **Argon2id Password Verification:** Target execution time $100\text{ ms} - 250\text{ ms}$ per verifikasi.

### 4.3 Hirarki Fallback Rute (Navigable Road Routes vs Estimasi Geometris)
Ditegaskan pemisahan konsep antara rute jalan raya (*navigable road route*) dan estimasi jarak (*distance estimation*):
- **Straight-line / Haversine Distance:** Hanya berfungsi sebagai alat komputasi **estimasi jarak & durasi matriks (geometric distance/ETA estimation)** ketika routing engine tidak dapat dihubungi. Straight-line **BUKAN** navigable road route dan tidak boleh ditampilkan sebagai instruksi navigasi jalan raya.
- **Hirarki Fallback Navigasi Rute yang Sebenarnya:**
  1. *Primary:* OSRM dynamic road calculation.
  2. *Secondary:* Cached Road Polyline dari Redis (pencarian rute rute serupa via geohash).
  3. *Tertiary:* Secondary Provider Fallback (openrouteservice / Google Routes adapter).
  4. *Quaternary:* **Manual Route Ordering Mode** (Driver/Owner menyusun urutan titik stop secara manual, dan navigasi belokan diserahkan ke aplikasi navigasi eksternal smartphone seperti Google Maps/Waze via intent/deep-link).

### 4.4 Deterministik Offline Conflict Resolution & Authority Matrix
Untuk mengatasi benturan data antara smartphone driver yang offline dan mutasi status di server, diberlakukan **Authority Matrix** yang deterministik:

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ DETERMINISTIC OFFLINE CONFLICT AUTHORITY MATRIX                                                        │
├────────────────────┬────────────────────┬──────────────────────────────────────────────────────────────┤
│ Entitas / State    │ Otoritas Tertinggi │ Aturan Resolusi Deterministik                                │
├────────────────────┼────────────────────┼──────────────────────────────────────────────────────────────┤
│ Terminal State     │ Server             │ State CANCELLED, COMPLETED, FAILED di server bersifat final;  │
│ Delivery           │ Authoritative      │ event offline driver tidak dapat menimpa state terminal ini. │
├────────────────────┼────────────────────┼──────────────────────────────────────────────────────────────┤
│ Bukti Lapangan     │ Driver Evidence    │ Jika driver menyelesaikan pengiriman offline saat status di  │
│ (POD & Foto)       │ Preservation       │ server CANCELLED, bukti POD TETAP DISIMPAN di DB; dibuatkan  │
│                    │                    │ tiket `delivery_conflicts` (status OPEN) untuk audit review. │
├────────────────────┼────────────────────┼──────────────────────────────────────────────────────────────┤
│ Stop Execution     │ Driver             │ Timestamp client dicatat sebagai `client_occurred_at`, namun │
│ Sequence           │ Execution Order    │ `received_at` server menentukan urutan audit server.         │
├────────────────────┼────────────────────┼──────────────────────────────────────────────────────────────┤
│ Replay Mutation    │ Idempotency Engine │ Duplicate submission dengan Idempotency-Key yang sama wajib  │
│                    │ (Deterministic)    │ mengembalikan response cached asli tanpa mutasi ganda.       │
├────────────────────┼────────────────────┼──────────────────────────────────────────────────────────────┤
│ Dispute Resolution │ Admin / Owner      │ Admin/Owner dapat menutup konflik via endpoint               │
│ Override           │ Discretionary      │ `/v1/conflicts/:id/resolve` dengan audit reason tercatat.    │
└────────────────────┴────────────────────┴──────────────────────────────────────────────────────────────┘
```

### 4.5 Technical Gate E2EE & Klasifikasi Fallback yang Jujur
Sebelum modul chat diimplementasikan penuh di Phase 11:
- **Feasibility Spike Gate (`E2EE-CHAT-001`):** Tim wajib membuktikan bahwa library E2EE (misal: `libsignal_protocol_dart` / Olm) berhasil di-compile, men-generate keypair lokal di KeyStore/Keychain mobile Flutter, dan melakukan enkripsi/dekripsi secara stabil.
- **Keputusan Gate:**
  - *Jika lolos spike:* Lanjutkan integrasi penuh Signal Protocol family (X3DH + Double Ratchet) dengan backend sebagai ciphertext relay.
  - *Jika gagal spike (kendala platform/FFI):* Beralih ke fallback terencana: **Authenticated Application-Layer Transport Encryption over TLS dengan Server-Managed Key**.
  - *Honesty Rule:* Sistem dan dokumentasi **DILARANG** mengklaim mode fallback tersebut sebagai "E2EE". Fitur wajib dilabeli secara transparan sebagai *Transport & Server-Managed Encrypted Messaging*.

### 4.6 Arsitektur CSRF Defense Multi-Layer untuk Admin Web
Pengamanan transport autentikasi browser Admin Web tidak mengandalkan satu header saja, melainkan pertahanan berlapis:
1. **SameSite & Secure Cookie:** Cookie refresh token dikonfigurasi dengan flag `HttpOnly; Secure; SameSite=Strict`.
2. **Strict Origin & Referer Verification:** Middleware memverifikasi header `Origin` dan `Referer` pada seluruh request mutasi (`POST`, `PATCH`, `DELETE`, `PUT`) agar mutlak berasal dari domain Admin Web yang terdaftar di allowlist.
3. **Synchronizer CSRF Token:** Endpoint `/v1/auth/csrf-token` menerbitkan token CSRF yang wajib disertakan pada header `X-CSRF-Token` pada setiap request mutasi berbasis cookie.
4. **Content-Security-Policy (CSP):** Header CSP ketat via Helmet mencegah eksekusi unauthorized inline script.

---

## 5. MVP Scope & Acceptance Boundary Matrix

```text
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: CORE OPERATIONAL MVP (Mandatory Release Gate - P0)                                │
│ ├── Bootstrap Super Admin, Autentikasi Argon2id, Session Lifecycle, RBAC & Anti-IDOR     │
│ ├── Manajemen User, Driver, Kendaraan, Delivery Order, Destinasi Stop & State Machine     │
│ ├── Geocoding Alamat, Route Ordering (Manual & Bounded 2-Opt Heuristic TSP)               │
│ ├── Ingest GPS Smartphone, Filter Akurasi, Deteksi Outlier Kecepatan & Histori Spasial    │
│ ├── WebSocket Live Map Broadcast ke Owner, Presence Tracker, Reconnection Handler         │
│ ├── Secure File Upload (Magic Bytes Check) & Proof of Delivery (Foto + Tanda Tangan)     │
│ ├── Offline Outbox Sync, Idempotency Engine & Rekonsiliasi Benturan State Deterministik   │
│ ├── Emergency SOS Multi-Channel Alert, Append-Only Audit Logging, Sanitized Logging       │
│ ├── Multi-Tier Rate Limiting, Helmet Security Headers, CORS Strict Allowlist              │
│ └── Contract Testing REST & WebSocket untuk pencegahan drift frontend-backend             │
└───────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
┌─────────────────────────────────────────────▼─────────────────────────────────────────────┐
│ TIER 2: REALTIME COMMUNICATIONS MVP (Integrated Target - P1 / P2)                         │
│ ├── Push Notification Wake-Up Bridge (FCM / APNs) untuk socket disconnected               │
│ ├── 1:1 Encrypted Chat (E2EE Ciphertext Relay / Honest Fallback Taxonomy)                 │
│ ├── 1:1 Push-to-Talk (PTT) WebRTC Voice Session Signaling & Authorization                 │
│ └── 1:1 Owner-Requested Video Call Session dengan Explicit Driver Consent Gate            │
│ *Prinsip: Kegagalan media WebRTC/PTT/Video tidak boleh mematikan pengiriman barang utama. │
└───────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
┌─────────────────────────────────────────────▼─────────────────────────────────────────────┐
│ TIER 3: EXTENDED ENTERPRISE / POST-MVP (Future Roadmap)                                   │
│ ├── Multi-Party WebRTC SFU dengan SFrame Media E2EE Encryption                            │
│ ├── Multi-Tenant SaaS Isolation & Billing Management                                      │
│ └── Machine Learning Traffic & ETA Predictive Modeling                                    │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Master Dependency Graph & Workstreams

```text
[Phase 0: Foundation, Arsitektur Modul & Resource Limits]
  │
  ├──► [Phase 1: Database Architecture & PostGIS Spatial Core]
  │      │
  │      ├──► [Phase 2: Authentication, Session, Device & Transport Strategy]
  │      │      │
  │      │      └──► [Phase 3: RBAC, Object-Level Auth & Mass-Assignment Engine]
  │      │             │
  │      │             ├──► [Phase 4: Core Domain & Transactional Event Outbox]
  │      │             │      │
  │      │             │      ├──► [Phase 5: Geocoding & Routing Resiliency Subsystem]
  │      │             │      │      │
  │      │             │      │      └──► [Phase 6: GPS Ingestion, Validation & Tracking]
  │      │             │      │             │
  │      │             │      │             └──► [Phase 7: Realtime Gateway & WebSocket]
  │      │             │      │                    │
  │      │             │      ├──► [Phase 8: Offline Outbox, Sync & Deterministic Conflict]
  │      │             │      │      │
  │      │             │      │      └──► [Phase 9: Secure File Upload & Proof of Delivery]
  │      │             │      │
  │      │             │      ├──► [Phase 10: Push Notification & Mobile Wake-Up Bridge]
  │      │             │      │      │
  │      │             │      │      ├──► [Phase 11: E2EE Feasibility Spike & Messaging]
  │      │             │      │      │
  │      │             │      │      └──► [Phase 12: WebRTC Signaling, PTT & Owner Video]
  │      │             │      │
  │      │             │      └──► [Phase 13: Emergency SOS & Security Telemetry]
  │      │             │
  │      │             └──► [Phase 14: Security Hardening, Audit & Anti-Abuse]
  │      │                    │
  │      │                    ├──► [Phase 15: Data Retention & Privacy Purge Engine]
  │      │                    │
  │      └────────────────────┴──► [Phase 16: Automated Testing Suite & Contract Tests]
  │                                 │
  │                                 └──► [Phase 17: Infra Coordination, Health & Backup]
  │                                        │
  │                                        └──► [Phase 18: Final Verification & MVP Gate]
```

---

## 7. Master Task Breakdown (73 Tasks)

---

### PHASE 0: FOUNDATION, ARSITEKTUR MODUL & RESOURCE LIMITS

#### `BE-CORE-001`: Inisialisasi Repository Backend & NestJS Modular Architecture
- **Tujuan:** Menyiapkan struktur project backend TypeScript/NestJS yang terstandarisasi, maintainable, dan siap untuk modular monolith.
- **Deskripsi:** Setup NestJS scaffolding dengan strict TypeScript configuration (`noImplicitAny`, `strictNullChecks`), modular directory structure (`auth`, `users`, `drivers`, `vehicles`, `deliveries`, `routes`, `tracking`, `communication`, `notifications`, `pod`, `audit`, `integrations`), konfigurasi path aliases, serta setup environment validation menggunakan `@nestjs/config` dan Joi/Zod.
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 2h, Impl: 6h, Test: 2h, Review: 2h)
- **Dependensi:** None
- **Fase:** Phase 0
- **Output:** Base codebase NestJS, `tsconfig.json`, modular layout, `src/config/configuration.ts`.
- **Definition of Done:** Server NestJS dapat booting dengan `npm run start:dev`, environment variable tervalidasi saat startup (gagal jika env wajib hilang), struktur modul terpisah rapi tanpa circular dependency.
- **Test Requirement:** Unit test untuk environment config loader; smoke test untuk bootstrap application.
- **Security Consideration:** Validasi tipe dan rentang nilai semua konfigurasi environment; tidak ada default secret yang hardcoded.
- **Catatan Dependency:** Koordinasi dengan tim DevOps terkait penamaan variable di `.env.example`.

#### `BE-CORE-002`: Global Exception Filter, Interceptor Korelasi & Standard API Envelope
- **Tujuan:** Menstandarisasi format response, penanganan error, serta tracking request end-to-end.
- **Deskripsi:** Membuat Global Exception Filter yang menangkap seluruh HTTP exception dan unhandled error, memetakan ke format JSON terstandarisasi (`{ success, data, error: { code, message, requestId }, timestamp }`), serta menambahkan Correlation/Request ID middleware (`x-request-id`) yang disematkan ke logger context dan response header.
- **Priority:** P0
- **Estimasi:** 1 Hari (Design: 2h, Impl: 4h, Test: 2h)
- **Dependensi:** `BE-CORE-001`
- **Fase:** Phase 0
- **Output:** `GlobalExceptionFilter`, `TransformInterceptor`, `RequestIdMiddleware`.
- **Definition of Done:** Seluruh response sukses dan error mengembalikan format envelope yang seragam; database error atau stack trace internal tidak pernah bocor ke client pada environment `production`.
- **Test Requirement:** Unit test custom error codes; integration test verifikasi sensor kebocoran stack trace pada response 500.
- **Security Consideration:** Mencegah information disclosure; semua database syntax error disamarkan menjadi generic error code yang aman.
- **Catatan Dependency:** Kontrak format error dibagikan ke tim FE (Owner Mobile, Driver Mobile, Admin Web).

#### `BE-CORE-003`: Spikes & Evaluation: ORM & Database Migration Engine
- **Tujuan:** Menentukan engine ORM/Database access yang paling optimal dan aman untuk kebutuhan relasional + PostGIS.
- **Deskripsi:** Melakukan spike teknis komparasi antara **Prisma** (dengan typed SQL/extensions), **Drizzle ORM**, dan **TypeORM**. Kriteria evaluasi: dukungan PostGIS `geometry(Point, 4326)`, kestabilan migrasi skema spasial, performa transaksi ACID kompleks, isolasi query parameterized, serta kemudahan tim.
- **Priority:** P0 (Spike / Decision)
- **Estimasi:** 2 Hari (Spike: 10h, Benchmark: 4h, Decision Record: 2h)
- **Dependensi:** `BE-CORE-001`
- **Fase:** Phase 0
- **Output:** Dokumen `ADR-001-ORM-SELECTION.md` dan prototype query PostGIS.
- **Definition of Done:** Keputusan final ORM tercatat di Architecture Decision Record dengan bukti pengujian query spasial (`ST_DWithin`, `ST_Distance`) dan script migrasi otomatis.
- **Test Requirement:** Benchmark latency dan memory footprint pada operasi batch insert 1000 record koordinat.
- **Security Consideration:** Memastikan ORM mendukung 100% parameterized queries untuk mencegah SQL Injection.
- **Catatan Dependency:** Konsultasi dengan tim BE terkait kenyamanan syntax.

#### `BE-CORE-004`: Global Request Limits, DTO Whitelisting & Mass-Assignment Guard
- **Tujuan:** Melindungi backend dari serangan mass-assignment, property injection, dan memory exhaustion akibat payload berukuran masif.
- **Deskripsi:** 
  1. Mengaktifkan global NestJS `ValidationPipe` dengan opsi `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`. Request yang mengirimkan property di luar DTO langsung ditolak dengan HTTP 400 Bad Request.
  2. Mengonfigurasi batas ukuran request body: JSON body maksimal **100 KB**, URL-encoded maksimal **50 KB**, Multipart stream maksimal **10 MB**.
  3. Menstandarisasi batasan DTO: string maksimal 255 karakter (deskripsi/catatan maks 1000), array item maksimal 50 elemen, batasan pagination default 20 dan maksimal 100 items per page (`@Max(100)`).
  4. Memastikan field kepemilikan/otoritas (`role`, `tenantId`, `userId`, `createdBy`, `isVerified`) tidak pernah diterima dari body client.
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `BE-CORE-002`
- **Fase:** Phase 0
- **Output:** Konfigurasi Global Validation Pipe di `main.ts`, base pagination DTO, custom validation decorators.
- **Definition of Done:** Injection field liar (misal: mengirim `{ role: "ADMIN" }` saat registrasi) ditolak otomatis; request payload JSON > 100 KB langsung diputus oleh body parser (HTTP 413 Payload Too Large).
- **Test Requirement:** Unit test validasi DTO dengan property asing; test HTTP 413 pada payload besar.
- **Security Consideration:** Mencegah privilege escalation via Mass Assignment (CWE-915) dan DoS via Large Body (CWE-400).
- **Catatan Dependency:** Tim FE wajib menyelaraskan struktur JSON request agar sesuai dengan DTO resmi tanpa field ekstra.

---

### PHASE 1: DATABASE ARCHITECTURE & POSTGIS SPATIAL CORE

#### `DB-GEO-001`: Skema Relasional Database & PostGIS Setup
- **Tujuan:** Menginisialisasi database PostgreSQL dengan ekstensi PostGIS dan mendefinisikan tabel master data.
- **Deskripsi:** Menulis migrasi database inisial untuk mengaktifkan ekstensi PostGIS (`CREATE EXTENSION IF NOT EXISTS postgis;`), membuat tabel: `users`, `roles`, `permissions`, `role_permissions`, `drivers`, `vehicles`, `vehicle_assignments`.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `BE-CORE-003`
- **Fase:** Phase 1
- **Output:** File migrasi SQL/ORM, diagram ERD sinkron, database seed dasar.
- **Definition of Done:** Ekstensi PostGIS aktif; seluruh foreign key, unique constraints, dan enum types (`account_status`, `driver_operational_status`, `vehicle_status`) terpasang dengan benar.
- **Test Requirement:** Integration test migrasi `up` dan `down` berjalan bersih tanpa error relasi.
- **Security Consideration:** Enforce constraint integrity pada level database; password hash column memiliki panjang yang memadai untuk Argon2id.
- **Catatan Dependency:** Koordinasi dengan DevOps untuk ketersediaan image PostgreSQL ber-PostGIS pada Docker Compose lokal & staging.

#### `DB-GEO-002`: Skema Spasial Pengiriman, Rute & Partisi Histori Lokasi
- **Tujuan:** Menyusun skema data transaksi delivery, stop koordinat spasial, dan tabel telemetri lokasi berperforma tinggi.
- **Deskripsi:** Membuat tabel: `deliveries`, `delivery_items`, `delivery_stops` (dengan kolom `geom geometry(Point, 4326)`), `routes`, `route_stops`, dan `location_points` (dengan kolom `geom geometry(Point, 4326)`). Menerapkan tabel partitioning pada `location_points` berdasarkan range waktu bulanan (`PARTITION BY RANGE (recorded_at)`) untuk menjaga performa histori query.
- **Priority:** P0
- **Estimasi:** 2.5 Hari (Design: 6h, Impl: 10h, Test: 4h)
- **Dependensi:** `DB-GEO-001`
- **Fase:** Phase 1
- **Output:** File migrasi skema delivery dan spatial telemetry, table partition trigger/DDL.
- **Definition of Done:** Kolom spasial `geometry(Point, 4326)` terbuat dengan valid; partition table otomatis menangani data koordinat sesuai bulan.
- **Test Requirement:** Test insert koordinat WGS84 dan query spasial dasar berhasil; validasi constraint SRID 4326.
- **Security Consideration:** Isolasi data historis; batasi hak akses tabel partisi sesuai role database.
- **Catatan Dependency:** Dokumentasi skema spasial dibagikan ke BE developers.

#### `DB-GEO-003`: Implementasi Indeks GiST Spasial & Database Constraints
- **Tujuan:** Mengoptimalkan query pencarian radius geofence, bounding box, dan jarak armada.
- **Deskripsi:** Membuat indeks spasial GiST pada tabel `delivery_stops(geom)` dan `location_points(geom)`. Menambahkan composite index pada `(driver_id, recorded_at DESC)` dan `(delivery_id, status)` untuk akselerasi query operational dashboard.
- **Priority:** P0
- **Estimasi:** 1 Hari (Design: 2h, Impl: 4h, Test: 2h)
- **Dependensi:** `DB-GEO-002`
- **Fase:** Phase 1
- **Output:** Skrip migrasi indeks GiST dan B-Tree index.
- **Definition of Done:** `EXPLAIN ANALYZE` membuktikan query berbasis `ST_DWithin` menggunakan `Index Scan using idx_..._geom on ...` (bukan Seq Scan).
- **Test Requirement:** Performance test query radius 500m pada 100.000 row data lokasi.
- **Security Consideration:** Mencegah database exhaustion DoS akibat full table scan pada query realtime map.
- **Catatan Dependency:** None.

---

### PHASE 2: AUTHENTICATION, SESSION, DEVICE & TRANSPORT STRATEGY

#### `SEC-AUTH-001`: Password Hashing Module (Argon2id) & Credential Validator
- **Tujuan:** Menyediakan layanan hashing password berstandar industri dengan resistensi terhadap GPU/ASIC cracking.
- **Deskripsi:** Implementasi `PasswordService` menggunakan algoritma Argon2id (konfigurasi baseline: time cost = 3, memory cost = 64MB, parallelism = 2). Menyediakan fungsi `hashPassword` dan `verifyPassword` dengan proteksi terhadap timing attack.
- **Priority:** P0
- **Estimasi:** 1 Hari (Design: 2h, Impl: 4h, Test: 2h)
- **Dependensi:** `BE-CORE-001`
- **Fase:** Phase 2
- **Output:** `PasswordService`, unit test cryptographic timing safety.
- **Definition of Done:** Password tersimpan dalam format safe Argon2id hash; timing verification terlindungi; zero plaintext password di memori/variabel global.
- **Test Requirement:** Unit test verifikasi password valid/invalid; benchmark waktu komputasi hash ~100-250ms per login request.
- **Security Consideration:** Resistensi terhadap brute-force offline; rate limiting wajib diterapkan pada endpoint login.
- **Catatan Dependency:** None.

#### `SEC-AUTH-002`: JWS Token Service (HS256 Baseline) & Key Configuration
- **Tujuan:** Menghasilkan JSON Web Signature (JWS) Access Token bertanda tangan kriptografis `HS256` dengan masa berlaku pendek dan klaim validasi lengkap.
- **Deskripsi:** Implementasi `TokenService` yang menerbitkan JWS Access Token (durasi: 15 menit) berisi payload minimum (`userId`, `role`, `sessionId`, `deviceId`). Menegakkan validasi ketat: `issuer` (`iss: dms-api`), `audience` (`aud: dms-clients`), `expiration` (`exp`), `not-before` (`nbf`), dan `issuedAt` (`iat`). Menggunakan algoritma tunggal `HS256` dengan high-entropy secret (512-bit) yang diinjeksi via env; menolak eksplisit algoritma `none` dan algoritma di luar allowlist `['HS256']`.
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 4h, Impl: 6h, Test: 2h)
- **Dependensi:** `SEC-AUTH-001`
- **Fase:** Phase 2
- **Output:** `TokenService`, `JwtStrategy`, `JwtAuthGuard`, `ADR-004-JWT-SIGNING-ALGORITHM.md`.
- **Definition of Done:** Token diverifikasi dengan strict signature check, issuer/audience validation, dan expiry time enforcement; algoritma `none` langsung ditolak.
- **Test Requirement:** Test penolakan token expired, token dengan signature salah, token dengan algoritma `none`, dan token dengan invalid issuer/audience.
- **Security Consideration:** Access token berumur pendek; secret token tidak pernah di-commit ke Git.
- **Catatan Dependency:** Tim FE harus menangani event 401 untuk memicu refresh token flow otomatis.

#### `SEC-AUTH-003`: Device Enrollment & Refresh Token Family Rotation Engine
- **Tujuan:** Menyediakan mekanisme perpanjangan session yang aman dengan deteksi pencurian token (Reuse Detection).
- **Deskripsi:** Membuat tabel `devices` dan `sessions`. Saat login, client mendaftarkan metadata device (platform, deviceId, appVersion). Endpoint `POST /v1/auth/refresh` menerbitkan Access Token baru dan merotasi Refresh Token lama ke Refresh Token baru dalam satu `token_family`. Jika token lama yang sudah terpakai digunakan kembali (indikasi pencurian token), seluruh session dalam family tersebut otomatis direvoke secara instan.
- **Priority:** P0
- **Estimasi:** 2.5 Hari (Design: 6h, Impl: 10h, Test: 4h)
- **Dependensi:** `SEC-AUTH-002`
- **Fase:** Phase 2
- **Output:** `SessionService`, skema `sessions`, skema `devices`, endpoint `/v1/auth/login`, `/v1/auth/refresh`.
- **Definition of Done:** Token rotation berjalan lancar; upaya reuse token lama langsung memblokir seluruh sesi device dan mencatat security event log.
- **Test Requirement:** Integration test simulasi replay attack pada refresh token yang memicu pencabutan otomatis seluruh session family.
- **Security Consideration:** Perlindungan maksimal terhadap token hijacking; refresh token disimpan dalam bentuk cryptographic hash di database.
- **Catatan Dependency:** Mobile FE wajib mengimplementasikan secure storage (Flutter Secure Storage) untuk menyimpan refresh token.

#### `SEC-AUTH-004`: Revocation Engine, Remote Logout & Redis Session Blacklist
- **Tujuan:** Memastikan akun yang dinonaktifkan atau session yang dicabut langsung kehilangan akses secara instan.
- **Deskripsi:** Mengintegrasikan Redis untuk session revocation store. Implementasi endpoint `POST /v1/auth/logout`, `POST /v1/sessions/:id/revoke`, dan `POST /v1/users/:id/disable`. Ketika user dinonaktifkan atau sesi direvoke, session ID dimasukkan ke Redis blacklist dengan TTL sesuai sisa umur access token, dan event disconnect dipancarkan ke WebSocket gateway.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `SEC-AUTH-003`
- **Fase:** Phase 2
- **Output:** `RevocationService`, `SessionRevocationGuard`, endpoint device/session management.
- **Definition of Done:** Pemanggilan API dengan token dari sesi yang telah direvoke langsung ditolak dengan HTTP 401 Unauthorized dalam hitungan milidetik; koneksi WebSocket terkait langsung terputus.
- **Test Requirement:** Test revocasi sesi tunggal dan seluruh sesi user; verifikasi token yang sah langsung tidak bisa dipakai setelah logout.
- **Security Consideration:** Mengatasi kelemahan stateless JWT dengan hybrid fast cache revocation lookup.
- **Catatan Dependency:** Koordinasi dengan DevOps untuk konfigurasi Redis persistence & memory limit.

#### `SEC-AUTH-005`: Secure Initial Admin Bootstrap & Activation Workflow
- **Tujuan:** Menyediakan mekanisme inisialisasi akun Super Admin pertama secara aman tanpa risiko default credential.
- **Deskripsi:** Membuat CLI / script command bootstrap (`npm run seed:admin`) yang hanya dapat dijalankan pada host lokal/container initialization dengan parameter aman dari environment atau one-time generated password. Implementasi alur aktivasi driver (`POST /v1/auth/activate`) menggunakan one-time secure activation token.
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `SEC-AUTH-003`
- **Fase:** Phase 2
- **Output:** CLI script bootstrap admin, modul aktivasi akun driver.
- **Definition of Done:** Admin pertama dapat di-bootstrap tanpa ekspos password ke repository; activation token hanya berlaku 1 kali dan memiliki batas kadaluarsa 24 jam.
- **Test Requirement:** Test bootstrap admin gagal jika admin sudah ada (anti-overwrite); test activation token sekali pakai.
- **Security Consideration:** Menghindari celah default password `admin/admin` pada instalasi baru.
- **Catatan Dependency:** Tim Admin Web dan Driver Mobile mengikuti spesifikasi aktivasi akun.

#### `SEC-AUTH-006`: Admin Web Authentication Transport & Multi-Layer CSRF Defense
- **Tujuan:** Mengamankan transport token pada browser Admin Web dari risiko pencurian XSS dan serangan CSRF dengan pertahanan multi-layer.
- **Deskripsi:** Menyusun arsitektur hybrid autentikasi:
  1. **Mobile Clients (Owner & Driver):** Menggunakan `Authorization: Bearer <access_token>` murni dengan refresh token tersimpan di secure hardware storage (KeyStore / Keychain).
  2. **Admin Web (Browser SPA):** Menggunakan short-lived in-memory Access Token + `HttpOnly`, `Secure`, `SameSite=Strict` Cookie untuk Refresh Token endpoint (`/v1/auth/refresh`). Menerapkan:
     - Strict Origin/Referer verification pada seluruh mutasi (`POST`, `PATCH`, `DELETE`, `PUT`).
     - Synchronizer CSRF Token pattern (`/v1/auth/csrf-token` header `X-CSRF-Token`).
     - Content-Security-Policy (CSP) via Helmet.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `SEC-AUTH-003`
- **Fase:** Phase 2
- **Output:** `ADR-003-ADMIN-AUTH-TRANSPORT.md`, `CsrfProtectionMiddleware`, cookie parser configuration.
- **Definition of Done:** Transport autentikasi browser terlindungi dari pembacaan script jahat (HttpOnly cookie) dan percobaan cross-site request forgery ditolak dengan HTTP 403 Forbidden.
- **Test Requirement:** Security test simulasi serangan CSRF antar origin; verifikasi cookie memiliki flag `HttpOnly`, `Secure`, dan `SameSite=Strict`.
- **Security Consideration:** Mitigasi Cross-Site Scripting (XSS) token theft dan Cross-Site Request Forgery (CSRF).
- **Catatan Dependency:** Tim Admin Web menyelaraskan alur penyimpanan token dan penyertaan header CSRF saat berkomunikasi dengan backend.

#### `SEC-AUTH-007`: Argon2id Resource & Concurrency Benchmark on Staging Profile
- **Tujuan:** Mengetahui dampak beban komputasi hashing Argon2id terhadap memori dan CPU VPS Staging 2 vCPU / 2 GB RAM di bawah kondisi login konkuren.
- **Deskripsi:** Melakukan load test benchmark terhadap endpoint hashing Argon2id dengan variasi parameter:
  - Memory cost: 32 MB vs 64 MB.
  - Iterations: 2 vs 3.
  - Concurrency: 1, 5, 10, dan 20 simultaneous login requests.
  Mengevaluasi apakah memori meluap (>70% total RAM) atau CPU terkunci. Menyesuaikan parameter hashing final pada config backend agar aman dari Linux OOM Killer.
- **Priority:** P0 (Spike & Tuning)
- **Estimasi:** 1 Hari (Benchmark: 4h, Tuning: 2h, Report: 2h)
- **Dependensi:** `SEC-AUTH-001`
- **Fase:** Phase 2
- **Output:** Laporan benchmark `REPORT-ARGON2ID-STAGING-PERFORMANCE.md` dan konfigurasi optimal.
- **Definition of Done:** Parameter Argon2id terbukti stabil pada VPS 2 GB RAM tanpa memicu OOM atau lonjakan latency > 500ms saat 10 user login bersamaan.
- **Test Requirement:** Autocannon / k6 concurrency load test script khusus endpoint `/v1/auth/login`.
- **Security Consideration:** Mencegah Denial of Service berbasis exhaust CPU/RAM akibat parameter hashing yang terlalu agresif.
- **Catatan Dependency:** Koordinasi dengan DevOps untuk memantau metrik cgroup Docker container saat benchmark berlangsung.

---

### PHASE 3: RBAC & OBJECT-LEVEL AUTHORIZATION ENGINE

#### `SEC-RBAC-001`: Server-Side RBAC Guard & Permission Matrix Evaluator
- **Tujuan:** Menegakkan batasan hak akses berbasis Role (Admin, Owner, Driver) pada seluruh endpoint API.
- **Deskripsi:** Implementasi custom decorator `@RequireRole(Role.ADMIN, Role.OWNER)` dan `@RequirePermission('delivery:create')` beserta `RolesGuard`. Penegakan hak akses dilakukan secara deklaratif pada level Controller dan Method di NestJS.
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `SEC-AUTH-002`
- **Fase:** Phase 3
- **Output:** `RolesGuard`, `PermissionsGuard`, `@RequireRole`, `@RequirePermission`.
- **Definition of Done:** Request dari user dengan role yang tidak memiliki izin ditolak dengan HTTP 403 Forbidden secara konsisten di seluruh route.
- **Test Requirement:** Unit test matrix RBAC untuk seluruh kombinasi role dan route.
- **Security Consideration:** Least privilege enforcement; UI hiding bukan security control.
- **Catatan Dependency:** FE menampilkan menu dan tombol sesuai role, namun backend menjadi pemutus mutlak.

#### `SEC-RBAC-002`: Object-Level Authorization Guard (Anti-IDOR / Anti-BOLA)
- **Tujuan:** Mencegah kerentanan IDOR (Insecure Direct Object Reference) dan BOLA (Broken Object Level Authorization).
- **Deskripsi:** Membuat reusable interceptor/guard dan service helper (`ResourceOwnershipService`) untuk memvalidasi kepemilikan resource sebelum operasi CRUD. Aturan: Driver hanya dapat membaca/mengubah delivery, stop, dan POD miliknya sendiri (`driver_id == me.driverId`); Owner hanya dapat mengelola data dalam tenant/perusahaannya; Admin memiliki akses penuh dengan audit log.
- **Priority:** P0
- **Estimasi:** 2.5 Hari (Design: 6h, Impl: 10h, Test: 4h)
- **Dependensi:** `SEC-RBAC-001`
- **Fase:** Phase 3
- **Output:** `ObjectOwnershipGuard`, `DeliveryScopeValidator`, `DriverScopeValidator`.
- **Definition of Done:** Driver A mencoba mengakses `GET /v1/deliveries/:id_milik_driver_b` langsung menerima HTTP 403 Forbidden / 404 Not Found.
- **Test Requirement:** Automated security test IDOR scan pada seluruh parameterized endpoints (`/deliveries/:id`, `/stops/:id`, `/me/*`, `/pod/:id`).
- **Security Consideration:** Validasi scope objek wajib dilakukan pada setiap query ke database (filter tenant/owner/driver pada klausa `WHERE`).
- **Catatan Dependency:** None.

#### `SEC-RBAC-003`: State-Based Authorization & Workflow Transition Guard
- **Tujuan:** Memastikan mutasi data hanya dapat dilakukan jika resource berada pada state yang valid.
- **Deskripsi:** Implementasi guard yang memvalidasi bahwa suatu aksi bisnis hanya sah pada status tertentu. Contoh: Driver tidak bisa menyelesaikan stop jika delivery berstatus `CANCELLED`; Owner tidak bisa mengedit barang jika delivery sudah `EN_ROUTE`; Driver tidak bisa upload POD jika stop belum `ARRIVED`.
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `SEC-RBAC-002`
- **Fase:** Phase 3
- **Output:** `StateTransitionGuard`, declarative `@AllowedStates(DeliveryStatus.ASSIGNED)`.
- **Definition of Done:** Percobaan aksi di luar state machine yang diizinkan ditolak dengan HTTP 409 Conflict / 422 Unprocessable Entity disertai error code terstruktur.
- **Test Requirement:** Unit test state transition validation untuk semua status pengiriman.
- **Security Consideration:** Mencegah race condition dan out-of-order manipulation oleh client nakal.
- **Catatan Dependency:** FE menangani HTTP 409 untuk menyegarkan tampilan data terkini ke user.

---

### PHASE 4: CORE DOMAIN & TRANSACTIONAL EVENT OUTBOX

#### `BE-DEL-001`: Modul User & Driver Lifecycle Management
- **Tujuan:** Menyediakan layanan administrasi user, pembuatan driver oleh Admin/Owner, dan manajemen profil driver.
- **Deskripsi:** Implementasi controller, service, repository, dan DTO untuk manajemen akun: `POST /v1/users` (Admin create Owner/Driver), `POST /v1/drivers` (Owner create Driver bila diizinkan), `GET /v1/users`, `PATCH /v1/users/:id`, `POST /v1/users/:id/disable`. Audit log otomatis mencatat ID pembuat akun.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `SEC-RBAC-002`
- **Fase:** Phase 4
- **Output:** `UsersModule`, `DriversModule`, DTO validasi, controller & service.
- **Definition of Done:** Admin dan Owner dapat mengelola user sesuai izin scope; Owner tidak pernah diizinkan membuat atau menaikkan user menjadi Admin.
- **Test Requirement:** Integration test pembuatan user, isolasi role, dan validasi duplikasi username/email/phone.
- **Security Consideration:** Validasi sanitasi input teks untuk mencegah XSS/HTML Injection pada nama dan data profil.
- **Catatan Dependency:** Digunakan oleh Admin Web dan Owner Mobile.

#### `BE-DEL-002`: Modul Vehicle Management & Vehicle Assignment
- **Tujuan:** Mengelola data armada kendaraan dan penugasan kendaraan ke driver aktif.
- **Deskripsi:** Implementasi `VehiclesModule`: CRUD kendaraan (tipe, nomor polisi, kapasitas beban kg, volume m3, status operasional), dan endpoint penugasan driver ke kendaraan `POST /v1/vehicles/:id/assign-driver`. Memvalidasi bahwa 1 kendaraan hanya dapat digunakan oleh 1 driver aktif pada rentang waktu yang sama.
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `BE-DEL-001`
- **Fase:** Phase 4
- **Output:** `VehiclesModule`, skema relasi assignment, endpoint manajemen armada.
- **Definition of Done:** Kendaraan berhasil didaftarkan dan di-assign; duplikasi assignment pada waktu bersamaan otomatis ditolak secara transaksional.
- **Test Requirement:** Test double assignment prevention menggunakan database transaction isolation.
- **Security Consideration:** RBAC check: hanya Admin/Owner yang dapat memodifikasi kendaraan.
- **Catatan Dependency:** Data kendaraan ditampilkan di Owner Mobile dan Admin Web.

#### `BE-DEL-003`: Delivery & Item Management Service
- **Tujuan:** Mengelola pembuatan pesanan pengiriman barang dan rincian item pengiriman.
- **Deskripsi:** Implementasi `DeliveriesModule`: `POST /v1/deliveries` (create delivery dengan kode unik, mode rute, tanggal rencana), `POST /v1/deliveries/:id/items` (menambahkan item, kuantitas, berat/volume), `GET /v1/deliveries`, `GET /v1/deliveries/:id`. Batas maksimal 50 item per delivery order.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `BE-DEL-002`
- **Fase:** Phase 4
- **Output:** `DeliveriesModule`, DTO create/update delivery, query filter delivery list.
- **Definition of Done:** Delivery dan item berhasil disimpan dalam satu transaksi database ACID; payload delivery tervalidasi ketat.
- **Test Requirement:** Integration test pembuatan delivery dengan 10 item sekaligus; rollback transaksi jika 1 item invalid.
- **Security Consideration:** Ownership scope validation: Owner hanya melihat delivery yang dibuat di perusahaannya.
- **Catatan Dependency:** Tim FE mengintegrasikan form pembuatan delivery di Owner Mobile.

#### `BE-DEL-004`: Delivery Stops & Destination Ordering Subsystem
- **Tujuan:** Mengelola daftar titik tujuan (stops) pada suatu delivery dengan koordinat geografis.
- **Deskripsi:** Endpoint untuk menambah/mengedit titik stop pengiriman: `POST /v1/deliveries/:id/stops` (nama penerima, alamat, koordinat lat/lng, radius geofence default 100m, nomor urut sequence), `PATCH /v1/deliveries/:id/stops/reorder` (mengubah urutan stop manual). Batas maksimal 25 stops per delivery.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `BE-DEL-003`, `DB-GEO-002`
- **Fase:** Phase 4
- **Output:** Submodul `DeliveryStopsService`, sequence ordering handler, point geometry generator.
- **Definition of Done:** Koordinat lat/lng otomatis dikonversi ke PostGIS `geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)`; urutan sequence terjaga konsisten tanpa gap.
- **Test Requirement:** Test validasi range koordinat (-90 s/d 90, -180 s/d 180); test reordering stops.
- **Security Consideration:** Anti-tampering sequence order; driver tidak dapat mengubah urutan jika route mode dikunci oleh Owner.
- **Catatan Dependency:** Terhubung dengan Geocoding Service pada Phase 5.

#### `BE-DEL-005`: Delivery Dispatch & Transactional State Machine Engine
- **Tujuan:** Mengontrol seluruh transisi status pengiriman dari penugasan hingga selesai secara transactional dan auditable.
- **Deskripsi:** Implementasi mesin status pengiriman: `ASSIGNED` ➔ `ACCEPTED` ➔ `EN_ROUTE` ➔ `ARRIVED` ➔ `UNLOADING` ➔ `DELIVERED` ➔ `COMPLETED`, penanganan `FAILED` ➔ `RESCHEDULED`, dan `CANCELLED`. Endpoint: `POST /v1/deliveries/:id/assign`, `POST /v1/me/deliveries/:id/accept`, `POST /v1/me/stops/:id/arrive`, `POST /v1/me/stops/:id/complete`, `POST /v1/deliveries/:id/cancel`. Setiap transisi memancarkan event ke transactional outbox.
- **Priority:** P0
- **Estimasi:** 3 Hari (Design: 6h, Impl: 12h, Test: 6h)
- **Dependensi:** `BE-DEL-004`, `SEC-RBAC-003`
- **Fase:** Phase 4
- **Output:** `DeliveryStateMachineService`, `DeliveryEventsRecorder`, API driver execution (`/v1/me/*`).
- **Definition of Done:** Seluruh transisi status divalidasi dengan row locking (`SELECT FOR UPDATE`) untuk mencegah race condition; riwayat event tercatat lengkap dengan actor dan timestamp.
- **Test Requirement:** Concurrent request testing untuk mencegah double accept atau duplicate status update.
- **Security Consideration:** Driver hanya dapat memajukan status delivery miliknya sendiri; pembatalan hanya boleh dilakukan oleh Owner/Admin dengan alasan tercatat.
- **Catatan Dependency:** Alur transisi status menjadi basis kerja Driver Mobile dan Owner Mobile.

#### `BE-DEL-006`: Transactional Event Outbox & Database-to-Realtime Consistency Engine
- **Tujuan:** Menjamin konsistensi 100% antara database commit dan publikasi event real-time (WebSocket & Push) tanpa silent data loss.
- **Deskripsi:** Implementasi pola **Transactional Outbox**:
  1. Setiap mutasi state bisnis (status delivery, stop arrived, POD submitted, SOS triggered) menulis event payload ke tabel `delivery_events` / `outbox_events` di dalam transaksi database yang sama (`COMMIT`).
  2. Background listener / transactional publisher membaca event baru dan menyiarkannya ke Redis Pub/Sub WebSocket gateway.
  3. Jika WebSocket gateway crash sesaat setelah DB commit, event tetap tersimpan di database dan otomatis di-retry saat publisher pulih.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `BE-DEL-005`
- **Fase:** Phase 4
- **Output:** `TransactionalOutboxPublisher`, skema `outbox_events`, publisher retry worker.
- **Definition of Done:** Tidak ada event bisnis yang hilang jika jaringan WebSocket terputus sesaat setelah transaksi database berhasil; client yang reconnect dapat mengambil event log yang terlewat.
- **Test Requirement:** Fault-injection test: simulasi crash koneksi Redis saat transaksi commit; verifikasi event otomatis dipublikasikan ulang setelah Redis pulih.
- **Security Consideration:** Mencegah desinkronisasi state antara dashboard live Owner dan status database server.
- **Catatan Dependency:** None.

---

### PHASE 5: GEOCODING & ROUTING RESILIENCY SUBSYSTEM

#### `BE-MAP-001`: Geocoding Provider Abstraction Layer & Caching Module
- **Tujuan:** Menyediakan layanan konversi alamat teks ke koordinat geografis (dan reverse geocoding) yang provider-agnostic dengan proteksi rate limit.
- **Deskripsi:** Membuat interface `GeocodingProvider` dengan adapter `NominatimProvider`, `GoogleMapsGeocodingAdapter`, dan `LocationIQAdapter`. Implementasi cache layer menggunakan Redis untuk menyimpan hasil pencarian alamat dengan TTL 30 hari. Menyediakan endpoint `POST /v1/geocoding/search` dan `POST /v1/geocoding/reverse` dengan rate limiting ketat (10 req/menit per user).
- **Priority:** P1
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `BE-DEL-004`
- **Fase:** Phase 5
- **Output:** `GeocodingModule`, adapter interface, Redis caching decorator.
- **Definition of Done:** Provider geocoding dapat diganti melalui konfigurasi `.env` tanpa mengubah domain logic; query alamat berulang langsung dilayani dari Redis cache (SLA Target P95 < 10ms).
- **Test Requirement:** Unit test mock provider geocoding; integration test verifikasi cache hit dan fallback handling saat provider eksternal timeout.
- **Security Consideration:** Perlindungan terhadap scraping/abuse kuota geocoding publik; rate limiting ketat.
- **Catatan Dependency:** Digunakan pada form input alamat destinasi di Owner Mobile.

#### `BE-MAP-002`: Routing Engine Provider Abstraction & Distance Matrix Service
- **Tujuan:** Menyediakan layanan kalkulasi jarak tempuh, durasi perjalanan, dan polyline rute jalan raya.
- **Deskripsi:** Membuat interface `RoutingProvider` dengan adapter `OsrmRoutingAdapter` (candidate baseline) dan fallback `GoogleRoutesAdapter`. Layanan menghitung distance matrix antar seluruh koordinat stop pengiriman (`POST /v1/routes/matrix`) dan menghasilkan rute navigasi. Membatasi dimensi matriks maksimal $25 \times 25$ koordinat. Tidak pernah memanggil routing engine eksternal pada setiap ping GPS.
- **Priority:** P1
- **Estimasi:** 2.5 Hari (Design: 6h, Impl: 10h, Test: 4h)
- **Dependensi:** `BE-MAP-001`
- **Fase:** Phase 5
- **Output:** `RoutingService`, OSRM client adapter, distance matrix calculator.
- **Definition of Done:** Distance & duration matrix berhasil dihitung; polyline rute terenkode/GeoJSON dikembalikan untuk visualisasi peta; kegagalan routing eksternal memiliki fallback error handling yang aman.
- **Test Requirement:** Integration test pemanggilan OSRM matrix dengan 10 koordinat; timeout handling test (3000ms max).
- **Security Consideration:** Payload size validation; sanitasi array koordinat input sebelum dikirim ke engine rute.
- **Catatan Dependency:** Rute ditampilkan di peta Owner Mobile dan peta Driver Mobile.

#### `BE-MAP-003`: Bounded Route Optimization Algorithm (Guard Factorial Explosion)
- **Tujuan:** Menghasilkan rekomendasi urutan rute terpendek yang efisien tanpa mengorbankan performa event loop server.
- **Deskripsi:** Implementasi algoritma optimasi stop rute (`POST /v1/deliveries/:id/route/recommend`):
  1. Untuk `n <= 5` stops: Menggunakan bounded **Exhaustive Permutation (Brute Force TSP)** untuk hasil optimal global.
  2. Untuk `n > 5` dan `n <= 25` stops: Wajib beralih otomatis ke **Nearest Neighbor + 2-Opt Heuristic** algorithm.
  3. Untuk `n > 25` stops: Menolak kalkulasi synchronous dan mengarahkan ke asynchronous background worker (BullMQ) atau membatasi jumlah stop.
- **Priority:** P1
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `BE-MAP-002`
- **Fase:** Phase 5
- **Output:** `RouteOptimizerService`, unit test algoritma TSP 2-Opt.
- **Definition of Done:** Request optimasi rute dengan 15 stops selesai dengan target SLA P95 < 500ms tanpa memblokir thread NestJS; kalkulasi factorial `n!` di atas 5 stops dilarang mutlak.
- **Test Requirement:** Benchmark CPU execution time untuk variasi jumlah stop (5, 8, 12, 20 stops); verifikasi tidak terjadi infinite loop pada 2-Opt.
- **Security Consideration:** Mencegah Denial of Service (DoS) berbasis algorithmic complexity attack (CWE-400).
- **Catatan Dependency:** Hasil rekomendasi rute dikirim ke Owner untuk dipilih/disetujui.

#### `BE-MAP-004`: Routing & Geocoding Resiliency: Circuit Breaker, Caching & Fallback
- **Tujuan:** Menjaga ketersediaan sistem saat provider mapping eksternal (OSRM / Nominatim) mengalami downtime, timeout, atau rate limit.
- **Deskripsi:** Implementasi pattern **Circuit Breaker** (menggunakan library `opossum` atau custom NestJS interceptor):
  - Timeout limit: 3000ms untuk routing HTTP call.
  - Bounded retry: 1x retry dengan backoff 300ms.
  - Circuit Breaker threshold: Jika 5 request berturut-turut gagal/timeout, circuit terbuka (OPEN) selama 30 detik.
  - Fallback logic: Saat circuit terbuka, sistem mengembalikan estimasi jarak garis lurus (Haversine PostGIS) khusus untuk kalkulasi biaya/matriks dan mengizinkan Owner/Driver beralih ke Mode Rute Manual tanpa error 500.
- **Priority:** P1
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `BE-MAP-003`
- **Fase:** Phase 5
- **Output:** `ResilientMappingInterceptor`, fallback straight-line calculator, circuit breaker state metrics.
- **Definition of Done:** Saat provider rute mati total, API delivery tetap berfungsi dengan status degraded (mode rute manual aktif); circuit breaker otomatis pulih saat provider online kembali.
- **Test Requirement:** Chaos test mematikan container OSRM mock; verifikasi API beralih ke fallback tanpa crash.
- **Security Consideration:** Mencegah cascading failure yang melumpuhkan seluruh backend akibat dependensi pihak ketiga.
- **Catatan Dependency:** Mobile FE menampilkan notifikasi "Layanan perutean otomatis sedang lambat, menggunakan mode rute manual".

---

### PHASE 6: GPS INGESTION, VALIDATION & TRACKING SERVICE

#### `GPS-ING-001`: GPS Telemetry Ingestion API & High-Throughput Pipe
- **Tujuan:** Menerima data koordinat lokasi driver secara cepat, efisien, dan tervalidasi.
- **Deskripsi:** Membuat endpoint `POST /v1/me/location` yang menerima payload: `{ latitude, longitude, accuracyM, speedMps, headingDeg, recordedAt, idempotencyKey }`. Menggunakan NestJS custom pipe untuk validasi format angka, pengecekan range koordinat (-90..90, -180..180), dan pencatatan otomatis timestamp penerimaan server (`received_at = NOW()`). Target SLA P95 < 50ms.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `DB-GEO-002`, `SEC-RBAC-002`
- **Fase:** Phase 6
- **Output:** `TrackingController`, `GpsIngestionPipe`, `LocationPointDto`.
- **Definition of Done:** Data telemetri diterima, tervalidasi, dan di-attach `driver_id` dari sesi JWT yang terotentikasi; response dikembalikan memenuhi SLA target P95 < 50ms.
- **Test Requirement:** Load testing ingestion endpoint dengan 100 concurrent requests per detik.
- **Security Consideration:** Driver hanya dapat mengirim lokasi atas nama dirinya sendiri; server timestamp selalu dicatat terpisah dari client timestamp untuk deteksi clock manipulation.
- **Catatan Dependency:** Driver Mobile mengirim telemetri secara berkala saat pengiriman aktif.

#### `GPS-ING-002`: GPS Outlier, Anti-Spoofing & Impossible Movement Guard
- **Tujuan:** Menyaring data koordinat palsu, noise akurasi buruk, dan lompatan posisi tidak masuk akal sebelum disimpan sebagai posisi valid.
- **Deskripsi:** Membuat `LocationSanitizationService` yang mengevaluasi:
  1. **Akurasi GPS:** Menolak/memflag koordinat dengan `accuracyM > 50` meter.
  2. **Timestamp Freshness:** Menolak koordinat dengan `recordedAt` lebih dari 10 menit di masa lalu atau lebih dari 1 menit di masa depan (clock skew).
  3. **Impossible Speed / Jump Detection:** Menghitung jarak spasial dari posisi valid terakhir dibagi selisih waktu (`velocity = delta_distance / delta_time`). Jika kecepatan melebihi 150 km/jam (41.6 m/s), koordinat ditandai sebagai `FLAGGED_ANOMALOUS` dan tidak dijadikan posisi live armada.
- **Priority:** P0
- **Estimasi:** 2.5 Hari (Design: 6h, Impl: 10h, Test: 4h)
- **Dependensi:** `GPS-ING-001`
- **Fase:** Phase 6
- **Output:** `LocationSanitizationService`, algoritma filter kecepatan Haversine/PostGIS.
- **Definition of Done:** Koordinat palsu atau noise tidak mengotori live map; data anomali tersimpan dengan status `validation_status = 'REJECTED'` atau `'FLAGGED'` untuk audit tanpa mematikan koneksi driver.
- **Test Requirement:** Unit test dengan dataset simulasi GPS teleportasi, jitter sinyal di terowongan, dan manipulasi jam perangkat.
- **Security Consideration:** Mencegah driver memalsukan posisi menggunakan aplikasi fake GPS / location mocking.
- **Catatan Dependency:** None.

#### `GPS-ING-003`: Latest Location State Store & Historical Retention Worker
- **Tujuan:** Menyimpan posisi terkini driver di fast cache (Redis) + database, serta mengelola retensi data histori.
- **Deskripsi:** Saat koordinat valid diterima, backend memperbarui:
  1. Redis Hash `driver:latest_location:{driverId}` untuk akses instan query live map Owner (SLA P95 < 10ms).
  2. Tabel `location_points` di PostgreSQL untuk data audit histori rute.
  3. Menyediakan background cron / retention worker yang menghapus atau mengarsipkan data histori lokasi lebih dari 30/90 hari sesuai kebijakan perusahaan.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `GPS-ING-002`
- **Fase:** Phase 6
- **Output:** `LatestLocationStore`, `LocationHistoryRetentionJob`, endpoint `GET /v1/drivers/:id/location-history`.
- **Definition of Done:** Posisi terkini dapat dibaca dengan target SLA P95 < 10ms dari Redis; query histori lokasi mendukung filter rentang waktu dan terproteksi RBAC; data lawas terarsip otomatis.
- **Test Requirement:** Test persistensi Redis & PostgreSQL; test retention job membersihkan data melewati threshold.
- **Security Consideration:** Akses riwayat lokasi driver sangat sensitif; hanya Owner dan Admin berwenang yang dapat melihat histori rute driver.
- **Catatan Dependency:** Data posisi terkini disiarkan ke WebSocket gateway di Phase 7.

#### `GPS-ING-004`: Geofence Proximity Evaluator & Arrival Suggestion Engine
- **Tujuan:** Mendeteksi secara otomatis saat driver telah tiba di dalam radius geofence titik tujuan stop.
- **Deskripsi:** Menggunakan query PostGIS `ST_DWithin(driver_geom, stop_geom, stop.geofence_radius_m)` pada saat ingest lokasi. Jika driver masuk ke dalam radius stop pengiriman yang aktif, backend menghasilkan event `geofence.entered` dan menyarankan transisi status `ARRIVED` (dengan konfirmasi driver untuk menghindari auto-complete palsu).
- **Priority:** P1
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `GPS-ING-003`, `DB-GEO-003`
- **Fase:** Phase 6
- **Output:** `GeofenceEvaluatorService`, event emitter geofence.
- **Definition of Done:** Masuknya driver ke area geofence (default radius 100m) terdeteksi secara real-time dan memicu notifikasi operasional ke Owner & Driver.
- **Test Requirement:** Spatial unit test simulasi titik koordinat di luar dan di dalam radius lingkaran geofence.
- **Security Consideration:** Verifikasi bahwa deteksi geofence hanya berjalan pada stop milik delivery yang sedang aktif dijalankan driver tersebut.
- **Catatan Dependency:** Driver Mobile menampilkan dialog "Anda telah sampai di lokasi tujuan" saat menerima event geofence.

---

### PHASE 7: REALTIME GATEWAY & WEBSOCKET INFRASTRUCTURE

#### `RT-WS-001`: WebSocket Gateway Setup & Handshake Authentication
- **Tujuan:** Membangun infrastruktur koneksi dua arah real-time dengan autentikasi berbasis token JWT saat koneksi dimulai.
- **Deskripsi:** Implementasi NestJS WebSocket Gateway (`@WebSocketGateway({ namespace: '/realtime' })`) berbasis Socket.io atau WS adapter. Middleware autentikasi memvalidasi JWT token pada handshake query/header (`auth.token`), memvalidasi status aktif user dan session ID di Redis, serta meng-assign user identity ke socket instance. Membatasi ukuran payload pesan WebSocket maksimal **64 KB per frame**.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `SEC-AUTH-004`
- **Fase:** Phase 7
- **Output:** `RealtimeGateway`, `WsJwtAuthMiddleware`, connection lifecycle handler (`handleConnection`, `handleDisconnect`).
- **Definition of Done:** Koneksi WebSocket tanpa token sah langsung ditolak; socket terputus otomatis jika user/session di-blacklist; lifecycle connect/disconnect tercatat rapi.
- **Test Requirement:** Integration test koneksi WSS dengan token valid, token kedaluwarsa, dan tanpa token.
- **Security Consideration:** Mencegah unauthorized connection open; pembatasan jumlah koneksi bersamaan per user (anti-socket exhaustion).
- **Catatan Dependency:** Owner Mobile dan Driver Mobile melakukan inisialisasi koneksi WSS setelah login.

#### `RT-WS-002`: Channel Authorization & Room Management (Tenant / Delivery Scope)
- **Tujuan:** Membatasi langganan room/channel WebSocket agar user hanya menerima event yang menjadi haknya.
- **Deskripsi:** Implementasi room subscription handler:
  1. `fleet:tenant_{id}`: Hanya dapat di-join oleh Owner dan Admin untuk monitoring armada.
  2. `delivery:{id}`: Hanya dapat di-join oleh Owner pembuat dan Driver yang ditugaskan.
  3. `user:{id}`: Private channel untuk notifikasi dan session command personal.
  Setiap event `join_room` divalidasi oleh `WsAuthorizationService` sebelum socket diizinkan bergabung.
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `RT-WS-001`, `SEC-RBAC-002`
- **Fase:** Phase 7
- **Output:** `WsAuthorizationService`, room event guards.
- **Definition of Done:** Driver mencoba join ke room `fleet:all` atau room delivery driver lain langsung ditolak dengan event `error:unauthorized`.
- **Test Requirement:** Automated test validasi isolasi room antar driver dan antar tenant.
- **Security Consideration:** Mencegah kebocoran data telemetri seluruh armada ke driver atau pihak luar.
- **Catatan Dependency:** None.

#### `RT-WS-003`: Live Location Broadcast & Throttled Event Fan-Out Pipeline
- **Tujuan:** Menyiarkan pembaruan lokasi driver ke map Owner secara real-time tanpa membebani bandwidth dan CPU.
- **Deskripsi:** Mengintegrasikan ingest lokasi valid (dari Phase 6) ke WebSocket fan-out. Menggunakan Redis Pub/Sub adapter (`@socket.io/redis-adapter`) untuk broadcast multi-instance. Menerapkan throttling rate limiter (maksimal 1 broadcast lokasi per 2-3 detik per driver) untuk mencegah flooding socket ke client Owner. Payload disanitasi: `{ driverId, deliveryId, lat, lng, heading, speed, updatedAt }`. Target SLA P95 < 250ms end-to-end.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `RT-WS-002`, `GPS-ING-003`
- **Fase:** Phase 7
- **Output:** `LocationBroadcastService`, event `driver.location.updated`, Redis Pub/Sub adapter.
- **Definition of Done:** Pembaruan lokasi driver muncul di room Owner terkait memenuhi SLA target P95 < 250ms; multi-node backend mampu mem-broadcast event secara sinkron via Redis.
- **Test Requirement:** Benchmark broadcast 100 koordinat/detik ke 50 viewer socket terhubung.
- **Security Consideration:** Lokasi disiarkan hanya ke room terotorisasi; data perangkat mentah tidak diikutsertakan dalam broadcast publik.
- **Catatan Dependency:** Peta live di Owner Mobile menerima event `driver.location.updated` untuk animasi marker armada.

#### `RT-WS-004`: Connection Heartbeat, Presence Tracker & Auto-Reconnection Handler
- **Tujuan:** Mengetahui status online/offline driver secara akurat dan menangani pemulihan koneksi yang putus.
- **Deskripsi:** Implementasi ping-pong heartbeat (interval: 25s, timeout: 10s). Jika ping gagal, status socket diubah menjadi `OFFLINE` di Redis presence set, dan event `fleet.driver.status_changed` dipancarkan ke Owner. Saat driver reconnect, socket secara otomatis mengembalikan subscription room yang sah.
- **Priority:** P1
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `RT-WS-003`
- **Fase:** Phase 7
- **Output:** `PresenceService`, heartbeat manager, event `fleet.driver.status_changed`.
- **Definition of Done:** Status online/offline driver terdeteksi secara real-time (< 15 detik setelah koneksi hilang mendadak); reconnection berlangsung mulus tanpa duplikasi socket listener.
- **Test Requirement:** Simulation test pemutusan koneksi internet secara tiba-tiba (TCP FIN vs silent drop).
- **Security Consideration:** Mencegah zombie connection pada server; cleanup socket session di Redis saat disconnect.
- **Catatan Dependency:** Owner Mobile menampilkan indikator status Driver (Hijau = Online, Abu-abu = Offline).

---

### PHASE 8: OFFLINE OUTBOX, SYNC & CONFLICT RESOLUTION ENGINE

#### `SYNC-OFF-001`: Idempotency Key Engine & Duplicate Command Suppressor
- **Tujuan:** Menjamin bahwa pengiriman request mutasi yang sama berulang kali (karena retry jaringan) tidak menghasilkan efek ganda di database.
- **Deskripsi:** Membuat tabel `idempotency_records` dan interceptor `IdempotencyInterceptor`. Client menyertakan header `Idempotency-Key: <UUID>`. Jika key sudah pernah diproses dalam rentang 24 jam, server mengembalikan response cache asli tanpa mengeksekusi business logic transaksi ulang.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `BE-DEL-005`
- **Fase:** Phase 8
- **Output:** `IdempotencyService`, `IdempotencyInterceptor`, skema `idempotency_records`.
- **Definition of Done:** Mengirim `POST /v1/me/stops/:id/complete` sebanyak 5 kali dengan Idempotency-Key yang sama hanya memproses 1 mutasi database; 4 request lainnya menerima response sukses yang identik.
- **Test Requirement:** Concurrency test 10 parallel request dengan idempotency key yang sama; verifikasi hanya 1 transaksi yang commit.
- **Security Consideration:** Mencegah double delivery completion, double payment, atau duplicate POD submission.
- **Catatan Dependency:** Driver Mobile wajib meng-generate UUIDv4 lokal untuk setiap action sebelum dimasukkan ke local outbox queue.

#### `SYNC-OFF-002`: Batch Sync Protocol & Outbox Reconciliation Endpoint
- **Tujuan:** Menerima antrean event yang terkumpul di smartphone driver selama offline dan merekonsiliasikannya ke server secara berurutan.
- **Deskripsi:** Endpoint `POST /v1/me/sync/outbox` yang menerima batch event (maksimal 50 events per request): array `[{ clientEventId, idempotencyKey, eventType, occurredAt, payload }]`. Backend memproses event secara sekuensial dalam satu transaksi database terisolasi, memvalidasi urutan state, dan mengembalikan status acknowledgement (`acked: [eventId]`, `conflicted: [...]`).
- **Priority:** P0
- **Estimasi:** 2.5 Hari (Design: 6h, Impl: 10h, Test: 4h)
- **Dependensi:** `SYNC-OFF-001`
- **Fase:** Phase 8
- **Output:** `OutboxSyncService`, `SyncBatchDto`, endpoint `/v1/me/sync/outbox`.
- **Definition of Done:** Puluhan event offline (arrive, unload, POD, complete) yang di-flush sekaligus saat sinyal pulih dapat diproses sesuai urutan waktu kejadian; client menerima ACK yang jelas.
- **Test Requirement:** Integration test sinkronisasi 20 event offline campuran (lokasi, status stop, POD) dalam satu batch payload.
- **Security Consideration:** Validasi urutan waktu dan anti-tampering timestamp (client time vs server time window check).
- **Catatan Dependency:** Mobile FE mengimplementasikan SQLite / Hive local queue untuk buffer event offline.

#### `SYNC-OFF-003`: Deterministic Conflict Resolver & Evidence Preservation
- **Tujuan:** Menangani benturan status saat event offline driver bertentangan dengan perubahan status di server secara deterministik tanpa menghilangkan bukti lapangan.
- **Deskripsi:** Mengimplementasikan *Deterministic Authority Matrix* pada tabel `delivery_conflicts`. Skenario: Driver menyelesaikan pengiriman saat offline, namun Owner telah membatalkan pengiriman (`CANCELLED`) di server.
  - Server mempertahankan status `CANCELLED` (Server Authoritative).
  - Server **menerima dan menyimpan bukti POD foto & tanda tangan** ke `delivery_conflicts` dengan status `OPEN`.
  - Mengirim notifikasi review ke Admin/Owner untuk penyelesaian sengketa manual.
- **Priority:** P1
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `SYNC-OFF-002`
- **Fase:** Phase 8
- **Output:** `ConflictResolutionService`, skema `delivery_conflicts`, endpoint `GET /v1/conflicts`, `POST /v1/conflicts/:id/resolve`.
- **Definition of Done:** Terjadi konflik status ➔ bukti POD tidak hilang ➔ terbuat tiket conflict ➔ Admin/Owner dapat memutuskan override status via dashboard secara deterministik.
- **Test Requirement:** Unit test simulasi skenario "Driver Delivered Offline vs Owner Cancelled Online" dan verifikasi preservasi data.
- **Security Consideration:** Menjamin integritas audit finansial dan kepatuhan barang; mencegah hilangnya data pertanggungjawaban driver.
- **Catatan Dependency:** Admin Web menampilkan menu resolusi konflik operasional.

---

### PHASE 9: SECURE FILE UPLOAD & PROOF OF DELIVERY (POD)

#### `POD-FILE-001`: Secure File Validation Pipe (Magic Bytes, Size & MIME Check)
- **Tujuan:** Mencegah pengunggahan file berbahaya (web shell, malware, script eksekusi) pada endpoint upload bukti pengiriman.
- **Deskripsi:** Membuat custom upload pipe `SecureFileUploadPipe` menggunakan library inspection header binary (seperti `file-type`). Aturan validasi:
  1. Hanya menerima tipe gambar: `image/jpeg`, `image/png`, `image/webp` (dan format signature svg/png tersanitasi).
  2. Memeriksa kecocokan antara ekstensi file, Content-Type header, dan **Magic Bytes (signature header binary)** asli file.
  3. Batas ukuran: Maksimal 5 MB untuk foto POD, maksimal 500 KB untuk tanda tangan.
  4. Menolak file executable (`.exe`, `.sh`, `.php`, `.js`, polyglot files).
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `BE-CORE-001`
- **Fase:** Phase 9
- **Output:** `SecureFileUploadPipe`, file validation utility, MIME whitelist config.
- **Definition of Done:** File binary palsu (misal: script PHP di-rename menjadi `.jpg`) langsung ditolak dengan HTTP 400 Bad Request; file gambar valid lolos validasi.
- **Test Requirement:** Security test upload berbagai jenis file berbahaya, file corrupt, dan file polyglot exploit.
- **Security Consideration:** Mencegah Remote Code Execution (RCE) dan Unrestricted File Upload vulnerability (OWASP Top 10).
- **Catatan Dependency:** Driver Mobile mengirim foto POD melalui multipart/form-data.

#### `POD-FILE-002`: Private Object Storage Adapter & Pre-Signed URL Generator
- **Tujuan:** Menyimpan file POD pada object storage privat (S3-Compatible / MinIO) tanpa mengekspos public URL ke internet.
- **Deskripsi:** Implementasi `StorageService` dengan driver S3/MinIO. Setiap file yang diunggah diberi nama acak cryptographically secure UUID (`pod/{deliveryId}/{stopId}/{uuid}.jpg`), dihitung checksum SHA-256-nya, dan disimpan di bucket non-public. Menyediakan fungsi generator Pre-Signed Download URL (durasi berlaku 15 menit) atau secure authenticated stream proxy.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `POD-FILE-001`
- **Fase:** Phase 9
- **Output:** `StorageService`, adapter MinIO/S3, skema `files`, helper pre-signed URL.
- **Definition of Done:** Bucket object storage 100% private; tidak ada akses publik langsung; file diunduh hanya melalui pre-signed URL berdurasi pendek.
- **Test Requirement:** Integration test upload file ke MinIO lokal; test kadaluarsa pre-signed URL setelah melewati rentang waktu.
- **Security Consideration:** Proteksi data privasi penerima barang; kredensial bucket disimpan dalam environment secret.
- **Catatan Dependency:** Koordinasi dengan DevOps untuk provisioning container MinIO di dev/staging environment.

#### `POD-FILE-003`: Proof of Delivery (POD) Metadata & Signature Management Service
- **Tujuan:** Mengelola data bukti pengiriman lengkap (foto barang, nama penerima, tanda tangan digital, catatan) terikat pada stop pengiriman.
- **Deskripsi:** Endpoint `POST /v1/me/stops/:id/pod`: menerima form data nama penerima, koordinat submit, foto file, dan signature file. Menyimpan metadata ke tabel `proof_of_delivery`, mengupdate status stop menjadi `DELIVERED`, dan mencatat event penyelesaian stop. Endpoint `GET /v1/deliveries/:id/pod` untuk Owner melihat bukti pengiriman dengan verifikasi otorisasi resource.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `POD-FILE-002`, `BE-DEL-005`
- **Fase:** Phase 9
- **Output:** `PodModule`, skema `proof_of_delivery`, endpoint submit & retrieve POD.
- **Definition of Done:** POD tersimpan lengkap, terikat pada delivery stop yang benar, dan hanya bisa diakses oleh Owner/Admin yang berwenang.
- **Test Requirement:** Integration test submit POD lengkap; verifikasi Driver lain tidak dapat mengakses POD tersebut (IDOR check).
- **Security Consideration:** Anti-tampering: POD yang sudah di-submit dan disetujui tidak dapat ditimpa/dihapus oleh Driver tanpa audit log.
- **Catatan Dependency:** Ditampilkan pada panel detail delivery di Owner Mobile dan Admin Web.

#### `POD-FILE-004`: Spike: Asynchronous Antivirus / Malware Scanning Integration
- **Tujuan:** Mengevaluasi integrasi malware scanning tanpa membebani staging VPS 2 GB RAM dengan daemon berat.
- **Deskripsi:** Melakukan spike teknis:
  1. Menilai dampak resource ClamAV lokal (butuh 1.2 GB RAM idle) vs Cloud/API scanning (seperti VirusTotal API / AWS GuardDuty / decoupled worker).
  2. Merancang asynchronous scanning hook: file di-upload ke temporary quarantine bucket, di-scan di background, dan dipindahkan ke bucket verified jika bersih.
  3. Memastikan MVP inti tidak bergantung pada daemon lokal yang memicu OOM.
- **Priority:** P1 (Spike / Decision)
- **Estimasi:** 1.5 Hari (Spike: 6h, Architecture Design: 4h, ADR: 2h)
- **Dependensi:** `POD-FILE-002`
- **Fase:** Phase 9
- **Output:** Dokumen `ADR-005-MALWARE-SCANNING-STRATEGY.md`, asynchronous scan queue interface.
- **Definition of Done:** Arsitektur scanning decoupled disetujui; core upload POD tidak terblokir oleh kegagalan scanner eksternal.
- **Test Requirement:** Benchmark penggunaan RAM container dengan dan tanpa scanner.
- **Security Consideration:** Defense in depth terhadap malicious binary payload.
- **Catatan Dependency:** DevOps menyediakan sandbox container untuk pengujian.

---

### PHASE 10: PUSH NOTIFICATION & MOBILE WAKE-UP BRIDGE

#### `NOTIF-PUSH-001`: Device Push Token Registration & Lifecycle Management
- **Tujuan:** Mengelola pendaftaran dan pencabutan push notification token (FCM / APNs) untuk setiap perangkat aktif.
- **Deskripsi:** Endpoint `POST /v1/devices/register-push-token` dan `POST /v1/devices/:id/revoke-push-token`. Menyimpan token FCM/APNs ke tabel `devices`, mengaitkannya dengan `user_id` dan `session_id`, serta membersihkan token yang sudah expired / uninstalled saat provider merespons token invalid (`NotRegistered` / `InvalidToken`).
- **Priority:** P1
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `SEC-AUTH-003`
- **Fase:** Phase 10
- **Output:** `PushTokenService`, controller device token, cleanup job.
- **Definition of Done:** Push token terasosiasi secara unik ke perangkat user; logout atau revocasi sesi otomatis menonaktifkan token perangkat tersebut.
- **Test Requirement:** Test registrasi token baru, update token, dan pemutusan relasi token saat sesi dihapus.
- **Security Consideration:** Mencegah kebocoran notifikasi ke pengguna perangkat lama (token lifecycle hygiene).
- **Catatan Dependency:** Owner Mobile dan Driver Mobile mengirim token FCM/APNs saat aplikasi pertama kali dibuka / login.

#### `NOTIF-PUSH-002`: Push Notification Provider Integration (FCM / APNs)
- **Tujuan:** Menyediakan modul pengiriman push notification untuk event operasional (penugasan baru, pesan masuk, peringatan SOS).
- **Deskripsi:** Mengintegrasikan Firebase Admin SDK (untuk FCM Android) dan APNs client (untuk iOS). Menyediakan abstraction service `PushNotificationService.sendToUser(userId, notificationPayload)`. Menerapkan antrean pengiriman background untuk mencegah blocking API request.
- **Priority:** P1
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `NOTIF-PUSH-001`
- **Fase:** Phase 10
- **Output:** `PushNotificationModule`, Firebase/APNs adapter, skema `notifications`.
- **Definition of Done:** Push notification terkirim dan diterima di perangkat driver/owner dalam < 2 detik saat event operasional terjadi.
- **Test Requirement:** Unit test mock provider FCM; integration test pengiriman push ke sandbox device token.
- **Security Consideration:** Push notification payload privacy: Tidak boleh mengirim data pribadi lengkap (seperti rincian barang, plaintext pesan, atau alamat detail) pada lock-screen notification payload.
- **Catatan Dependency:** Kredensial Firebase Service Account JSON disediakan via environment secret oleh DevOps.

#### `NOTIF-PUSH-003`: Mobile Call Wake-Up Bridge & Durable Pending Session State
- **Tujuan:** Membangunkan aplikasi mobile driver saat menerima panggilan suara (PTT) atau video ketika koneksi WebSocket sedang offline/tertidur.
- **Deskripsi:** Logika orkestrasi pemanggilan:
  1. Owner memulai sesi PTT/Video ➔ Backend membuat record `realtime_sessions` dengan status `PENDING`.
  2. Backend memeriksa status koneksi WebSocket Driver.
  3. Jika online ➔ Kirim signaling langsung via WSS.
  4. Jika offline/background ➔ Kirim high-priority data push (FCM High Priority / APNs VoIP PushKit) sebagai sinyal wake-up.
  5. Driver menerima push ➔ Membuka aplikasi/reconnect WSS ➔ Mengambil state pending session dari backend ➔ Menampilkan prompt accept/decline.
  6. Sesi pending otomatis kedaluwarsa setelah 30-45 detik jika tidak dijawab.
- **Priority:** P1
- **Estimasi:** 2.5 Hari (Design: 6h, Impl: 10h, Test: 4h)
- **Dependensi:** `NOTIF-PUSH-002`, `RT-WS-004`
- **Fase:** Phase 10
- **Output:** `CallWakeUpBridgeService`, skema `realtime_sessions`, handling pending session.
- **Definition of Done:** Permintaan panggilan tidak pernah hilang meskipun socket mati; pending session memiliki masa kadaluarsa (timeout 30-45 detik); driver yang bangun dari push dapat langsung bergabung ke sesi.
- **Test Requirement:** Test skenario wake-up: driver socket disconnected ➔ owner request call ➔ push terkirim ➔ driver connect & accept sebelum timeout.
- **Security Consideration:** Otorisasi sesi diverifikasi ulang saat driver accept; panggilan yang sudah expired otomatis di-reject.
- **Catatan Dependency:** FE Mobile menangani background push receiver dan incoming call display.

---

### PHASE 11: END-TO-END ENCRYPTED (E2EE) MESSAGING SERVICE

#### `E2EE-CHAT-001`: Technical Feasibility Spike: E2EE Protocol & Mobile Library Gate
- **Tujuan:** Memvalidasi kelayakan teknis implementasi protokol E2EE pada mobile Flutter sebelum integrasi penuh dimulai.
- **Deskripsi:** 
  1. Melakukan spike teknis implementasi library E2EE (kandidat: `libsignal_protocol_dart` / Olm) pada target Android & iOS.
  2. Menguji: Pembuatan keypair identity, registrasi prekey, serialisasi ciphertext envelope, dan penyimpanan private key di KeyStore/Keychain.
  3. **Gate Decision:** Jika spike lolos ➔ lanjut ke `E2EE-CHAT-002..003` (Full E2EE). Jika gagal ➔ beralih ke *Transport & Server-Managed Encrypted Messaging* sesuai taxonomy fallback dan jangan dilabeli sebagai E2EE.
- **Priority:** P1 (Spike & Gate)
- **Estimasi:** 2 Hari (Spike: 10h, Evaluation: 4h, Decision Record: 2h)
- **Dependensi:** `BE-CORE-001`
- **Fase:** Phase 11
- **Output:** Dokumen `ADR-002-E2EE-PROTOCOL-SELECTION.md`, prototype mobile key exchange.
- **Definition of Done:** Feasibility gate resmi diputuskan bersama tim FE Flutter; format envelope dan protokol disepakati.
- **Test Requirement:** PoC pertukaran pesan terenkripsi antar dua client mock via backend relay.
- **Security Consideration:** Verifikasi lisensi dan zero custom crypto.
- **Catatan Dependency:** Dikerjakan bersama tim Mobile FE Flutter.

#### `E2EE-CHAT-002`: Prekey Bundle Store & Identity Key Management Subsystem
- **Tujuan:** Menyediakan layanan penyimpanan dan distribusi public identity key dan one-time prekeys untuk inisiasi sesi E2EE asynchronous.
- **Deskripsi:** Membuat tabel `device_keys` (kolom: `device_id`, `identity_key_public`, `signed_prekey_public`, `signed_prekey_signature`, `one_time_prekeys_json`). Endpoint:
  - `POST /v1/keys/upload`: Mendaftarkan public identity key dan batch 100 one-time prekeys dari client.
  - `GET /v1/keys/bundle/:deviceId`: Mengambil prekey bundle perangkat target untuk inisiasi sesi X3DH.
  Backend mengonsumsi 1 one-time prekey setiap kali bundle diambil (prekey exhaustion tracking).
- **Priority:** P1
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `E2EE-CHAT-001`, `SEC-AUTH-003`
- **Fase:** Phase 11
- **Output:** `KeyManagementModule`, skema `device_keys`, endpoint prekey bundle upload & fetch.
- **Definition of Done:** Public key tersimpan aman; server tidak pernah meminta atau menyimpan private key; one-time prekey otomatis berkurang saat diambil dan client diberitahu jika stok prekey menipis.
- **Test Requirement:** Test upload 100 prekey, pengambilan bundle secara berurutan, dan verifikasi konsumsi prekey unik.
- **Security Consideration:** Anti-MITM: Public key ditandatangani oleh identity key perangkat; server hanya memfasilitasi pertukaran public key.
- **Catatan Dependency:** Client mobile men-generate keypair lokal saat registrasi perangkat.

#### `E2EE-CHAT-003`: Encrypted Message Relay & Ciphertext Envelope Storage
- **Tujuan:** Mengirimkan dan menyimpan pesan chat dalam bentuk ciphertext tanpa server mampu membaca konten pesan asli.
- **Deskripsi:** Membuat tabel `conversations` dan `messages` (kolom: `id`, `conversation_id`, `sender_device_id`, `recipient_device_id`, `protocol_version`, `ciphertext_blob`, `header_json`, `created_at`, `delivered_at`, `read_at`). Tidak ada kolom `plaintext_body` di database. Endpoint:
  - `POST /v1/conversations/:id/messages`: Menerima ciphertext envelope, memvalidasi otorisasi anggota percakapan, menyimpan ciphertext, dan memancarkan event `message.created` via WebSocket / Push ke penerima.
  - `GET /v1/conversations/:id/messages`: Mengambil histori ciphertext terenkripsi untuk didekripsi lokal oleh client.
- **Priority:** P1
- **Estimasi:** 2.5 Hari (Design: 6h, Impl: 10h, Test: 4h)
- **Dependensi:** `E2EE-CHAT-002`, `RT-WS-003`
- **Fase:** Phase 11
- **Output:** `ChatModule`, skema `messages`, WebSocket chat event handler.
- **Definition of Done:** Pesan terkirim secara real-time antar Owner dan Driver; database hanya berisi ciphertext binary/base64; log server tidak pernah mencatat isi pesan dalam bentuk terbaca.
- **Test Requirement:** Integration test pengiriman pesan; database inspection test membuktikan tidak ada plaintext yang tersimpan di kolom DB atau log file.
- **Security Consideration:** Confidentiality against curious backend operator (Threat Model Layer C); sanitasi metadata pengiriman.
- **Catatan Dependency:** Mobile FE bertanggung jawab atas enkripsi dan dekripsi pesan di endpoint.

#### `E2EE-CHAT-004`: Message Receipt (Delivered & Read Status) & Delivery Acknowledgement
- **Tujuan:** Mengelola status pengiriman pesan (sent, delivered, read) secara terotentikasi.
- **Deskripsi:** Endpoint dan event WebSocket untuk konfirmasi tanda terima: `POST /v1/messages/:id/ack-delivered` dan `POST /v1/messages/:id/ack-read`. Backend memperbarui status pesan dan meneruskan event tanda centang (`message.receipt_updated`) ke pengirim.
- **Priority:** P2
- **Estimasi:** 1 Hari (Design: 2h, Impl: 4h, Test: 2h)
- **Dependensi:** `E2EE-CHAT-003`
- **Fase:** Phase 11
- **Output:** Receipt handler di `ChatModule`, WebSocket event receipt.
- **Definition of Done:** Status pesan terupdate akurat (centang 1, centang 2, centang biru/baca) tanpa membocorkan isi percakapan.
- **Test Requirement:** Test lifecycle status pesan dari dikirim ➔ diterima ➔ dibaca.
- **Security Consideration:** Otorisasi: Hanya penerima pesan yang sah yang dapat mengubah status menjadi `delivered` atau `read`.
- **Catatan Dependency:** FE menampilkan ikon tanda terima pada UI chat.

---

### PHASE 12: WEBRTC SIGNALING, PTT & OWNER VIDEO SESSION

#### `RTC-MEDIA-001`: WebRTC Signaling Gateway, Ephemeral TURN Credential & Replay Guard
- **Tujuan:** Memfasilitasi pertukaran SDP offer/answer dan ICE candidates antar perangkat dengan kredensial TURN yang aman, anti-replay, dan berumur pendek.
- **Deskripsi:** 
  1. Implementasi signaling handler pada WebSocket (`signal:offer`, `signal:answer`, `signal:ice-candidate`). Setiap pesan signaling wajib menyertakan `sessionNonce` dan `timestamp` yang divalidasi oleh anti-replay cache Redis (TTL 60s).
  2. Integrasi layanan penerbitan kredensial TURN sementara (**TURN REST API / Time-Limited Ephemeral Credentials** menggunakan shared secret HMAC-SHA1: `username = timestamp:userId`, `password = HMAC(secret, username)`). Kredensial berlaku 1 jam.
  3. Validasi ketat SDP (maks 32 KB) dan ICE Candidate (maks 2 KB) untuk mencegah payload injection.
- **Priority:** P1
- **Estimasi:** 2.5 Hari (Design: 6h, Impl: 10h, Test: 4h)
- **Dependensi:** `RT-WS-002`
- **Fase:** Phase 12
- **Output:** `WebRtcSignalingGateway`, `TurnCredentialService`, event signaling handler, anti-replay pipe.
- **Definition of Done:** Kredensial ICE/TURN diterbitkan dengan masa aktif terbatas; signaling SDP dan ICE candidate diteruskan secara instan (< 50ms) antar peer yang terotentikasi; replayed signaling message ditolak seketika.
- **Test Requirement:** Unit test komputasi HMAC kredensial TURN; integration test pertukaran SDP offer-answer via WSS; test penolakan duplicate nonce.
- **Security Consideration:** Mencegah pencurian bandwidth TURN relay oleh pihak luar (ephemeral credentials); media audio/video tidak pernah melewati server REST.
- **Catatan Dependency:** DevOps menyediakan shared secret TURN server (Coturn) di environment backend.

#### `RTC-MEDIA-002`: Push-to-Talk (PTT) Voice Session Controller & Authorization
- **Tujuan:** Mengatur sesi komunikasi suara satu arah (Walkie-Talkie / PTT) yang diinisiasi oleh Owner ke Driver.
- **Deskripsi:** Endpoint `POST /v1/voice-sessions` dan event signaling PTT. Aturan otorisasi:
  1. Hanya Owner yang dapat menginisiasi PTT ke Driver yang ditugaskan.
  2. Driver yang menerima PTT otomatis mendengarkan stream suara via speaker/headset (jika izin mikrofon/audio aktif).
  3. Backend memvalidasi sesi aktif, mencatat metadata sesi ke audit log (tanpa merekam audio), dan memutus sesi jika durasi melebihi batas (misal: 60 detik per transmisi bicara).
- **Priority:** P1
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `RTC-MEDIA-001`, `SEC-RBAC-002`
- **Fase:** Phase 12
- **Output:** `VoiceSessionService`, controller voice session, event `ptt.started`, `ptt.ended`.
- **Definition of Done:** Sesi suara terinisiasi secara sah; transmisi audio terenkripsi menggunakan WebRTC DTLS-SRTP antar perangkat; sesi otomatis timeout jika tombol bicara dilepas.
- **Test Requirement:** Test otorisasi: Driver dilarang men-trigger PTT ke Driver lain; verifikasi terminasi sesi saat timeout.
- **Security Consideration:** Transport media terenkripsi wajib (DTLS-SRTP); sniffing jaringan Wi-Fi tidak menghasilkan audio terbaca.
- **Catatan Dependency:** Mobile FE menangani audio recording, buffering, and playback.

#### `RTC-MEDIA-003`: Owner-Requested Video Call Session & Driver Consent Gate
- **Tujuan:** Mengelola permintaan video live streaming dari armada driver oleh Owner dengan persetujuan eksplisit driver.
- **Deskripsi:** Endpoint `POST /v1/video-sessions` (Owner request video), `POST /v1/video-sessions/:id/accept` (Driver accept), `POST /v1/video-sessions/:id/decline` (Driver decline), dan `POST /v1/video-sessions/:id/end`. Kamera driver **tidak pernah boleh aktif otomatis tanpa persetujuan eksplisit (consent)** dari driver di layar HP. Sesi video memiliki timeout inisiasi (30s) dan auto-disconnect setelah 10 menit untuk efisiensi kuota.
- **Priority:** P2
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `RTC-MEDIA-001`
- **Fase:** Phase 12
- **Output:** `VideoSessionService`, controller video session, consent management workflow.
- **Definition of Done:** Alur request ➔ accept/decline ➔ WebRTC connection ➔ teardown berjalan mulus; kamera driver hanya aktif setelah tombol terima ditekan.
- **Test Requirement:** Test skenario: Driver menolak video request; test timeout otomatis jika driver tidak merespons dalam 30 detik.
- **Security Consideration:** Privasi driver (anti-spying): Server menolak segala bentuk bypass consent kamera; audit log mencatat setiap permintaan dan durasi video call.
- **Catatan Dependency:** Driver Mobile menampilkan incoming video modal dengan tombol Accept dan Decline.

---

### PHASE 13: EMERGENCY SOS & SECURITY EVENT SUBSYSTEM

#### `SEC-SOS-001`: Emergency SOS Ingestion & High-Priority Multi-Channel Broadcast
- **Tujuan:** Menyediakan tombol darurat SOS bagi driver saat mengalami kecelakaan, pembegalan, atau insiden kritis di jalan.
- **Deskripsi:** Endpoint prioritas tinggi `POST /v1/me/emergency/sos` yang menerima payload: `{ deliveryId, latitude, longitude, emergencyType, note }`. Logika eksekusi:
  1. Mengabaikan rate limiting standar untuk request SOS.
  2. Menyimpan record darurat ke tabel `emergencies` dengan status `TRIGGERED`.
  3. Mengambil koordinat GPS terakhir yang terverifikasi.
  4. Menyiarkan alert darurat prioritas tinggi secara instan ke seluruh channel: WebSocket room `fleet:all`, High-Priority FCM Push ke semua Owner/Admin, dan mencatat Security Event Log.
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `RT-WS-003`, `NOTIF-PUSH-002`
- **Fase:** Phase 13
- **Output:** `EmergencyModule`, skema `emergencies`, event `emergency.created`, SOS broadcast pipe.
- **Definition of Done:** SOS yang ditekan driver langsung memicu alarm visual & audio di dashboard Admin Web dan Owner Mobile dalam < 1 detik.
- **Test Requirement:** Integration test trigger SOS; verifikasi broadcast terkirim ke multi-channel secara simultan.
- **Security Consideration:** Data SOS tidak boleh di-throttle; identitas driver dan lokasi wajib di-attach otomatis dari server session.
- **Catatan Dependency:** Owner Mobile dan Admin Web menampilkan banner darurat merah berkedip saat menerima event SOS.

#### `SEC-SOS-002`: Emergency Incident Resolution & Post-Incident Audit Trail
- **Tujuan:** Mengelola penanganan insiden darurat hingga selesai dan mendokumentasikan tindakan penanganan.
- **Deskripsi:** Endpoint `POST /v1/emergencies/:id/resolve` (Admin/Owner mencatat tindakan yang diambil, bantuan yang dikirim, dan menutup status insiden: `RESOLVED` / `FALSE_ALARM`). Seluruh riwayat waktu insiden (waktu trigger, waktu respon pertama, waktu selesai) tercatat permanen di audit trail untuk evaluasi SOP keselamatan armada.
- **Priority:** P1
- **Estimasi:** 1 Hari (Design: 2h, Impl: 4h, Test: 2h)
- **Dependensi:** `SEC-SOS-001`
- **Fase:** Phase 13
- **Output:** Resolusi handler di `EmergencyModule`, audit reporting insiden.
- **Definition of Done:** Insiden dapat ditutup dengan catatan penanganan resmi; riwayat insiden tersimpan permanen dan tidak dapat dihapus.
- **Test Requirement:** Test resolusi insiden oleh Admin/Owner; verifikasi Driver tidak memiliki izin menutup tiket SOS sendiri.
- **Security Consideration:** Integritas data pertanggungjawaban hukum dan asuransi.
- **Catatan Dependency:** Admin Web menampilkan form penyelesaian insiden darurat.

---

### PHASE 14: SECURITY HARDENING, AUDIT & ANTI-ABUSE CONTROLS

#### `SEC-HARD-001`: Multi-Tier Rate Limiting & Abuse Protection (Throttler + Redis)
- **Tujuan:** Melindungi backend dari serangan brute-force, credential stuffing, scraping data, dan flooding DoS.
- **Deskripsi:** Implementasi `@nestjs/throttler` terintegrasi dengan Redis storage adapter. Menerapkan batas rate limit berlapis:
  1. **Global Default:** Maksimal 120 req/menit per IP.
  2. **Auth Endpoints (`/v1/auth/login`, `/refresh`, `/activate`):** Maksimal 5 req/menit per IP & Username (mencegah brute-force).
  3. **Location Ingestion (`/v1/me/location`):** Maksimal 60 req/menit per driver session.
  4. **Geocoding & Route Optimization:** Maksimal 15 req/menit per user.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `BE-CORE-001`
- **Fase:** Phase 14
- **Output:** `SecurityRateLimitModule`, custom Throttler guards, rate limit error envelope (`HTTP 429 Too Many Requests`).
- **Definition of Done:** Request melebihi batas langsung menerima HTTP 429 dengan header `Retry-After`; percobaan brute-force login diblokir otomatis.
- **Test Requirement:** Automated load script pengujian threshold rate limit pada endpoint login dan endpoint umum.
- **Security Consideration:** Mitigasi OWASP API Security Top 10 (Lack of Resources & Rate Limiting).
- **Catatan Dependency:** FE menangani status code 429 dan menampilkan pesan "Terlalu banyak permintaan, coba beberapa saat lagi".

#### `SEC-HARD-002`: Strict CORS Allowlist, Helmet Security Headers & Request Sanitizer
- **Tujuan:** Memproteksi surface API dari serangan berbasis browser (XSS, Clickjacking, MIME-sniffing, CSRF).
- **Deskripsi:** Konfigurasi library `helmet` pada NestJS bootstrap:
  - `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
  - Konfigurasi CORS dengan strict origin allowlist dari environment variable (hanya domain Admin Web dan origin mobile app yang diizinkan; larang wildcard `*` pada authenticated route).
  - Request body size limit: Maksimal 100 KB untuk JSON, maksimal 10 MB untuk multipart upload.
- **Priority:** P0
- **Estimasi:** 1 Hari (Design: 2h, Impl: 4h, Test: 2h)
- **Dependensi:** `BE-CORE-001`
- **Fase:** Phase 14
- **Output:** Konfigurasi Helmet, CORS middleware, body parser limiter di `main.ts`.
- **Definition of Done:** Seluruh security headers muncul di response header HTTP; request dari domain unauthorized ditolak oleh CORS policy.
- **Test Requirement:** Automated security header scan (analisis output curl `-I`); CORS preflight request test.
- **Security Consideration:** Penguatan pertahanan perimeter web surface.
- **Catatan Dependency:** Domain Admin Web wajib didaftarkan di environment variable `CORS_ALLOWED_ORIGINS`.

#### `SEC-HARD-003`: Append-Only Audit Logging Subsystem
- **Tujuan:** Mencatat seluruh tindakan administratif, perubahan data sensitif, dan mutasi pengiriman untuk kepatuhan dan forensik keamanan.
- **Deskripsi:** Membuat tabel `audit_logs` (kolom: `id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `result`, `request_id`, `ip_address`, `user_agent`, `created_at`). Menggunakan NestJS Interceptor `@AuditLog('DELIVERY_CANCELLED')` untuk mencatat mutasi data secara otomatis. Tabel bersifat **append-only** (larang mutasi `UPDATE` dan `DELETE` pada level database rule).
- **Priority:** P0
- **Estimasi:** 2.5 Hari (Design: 6h, Impl: 10h, Test: 4h)
- **Dependensi:** `BE-DEL-005`, `SEC-RBAC-002`
- **Fase:** Phase 14
- **Output:** `AuditModule`, `@AuditLog` decorator, skema `audit_logs`, endpoint `GET /v1/audit-logs` (Admin only).
- **Definition of Done:** Seluruh event penting (user created, role changed, delivery assigned/cancelled, device revoked, SOS triggered) tercatat otomatis di audit log; tabel tidak dapat dimodifikasi oleh user biasa.
- **Test Requirement:** Test verifikasi pencatatan audit log saat terjadi aksi administratif; test database constraint larangan update tabel audit.
- **Security Consideration:** Non-repudiation and forensic readiness; audit log tidak pernah mencatat password, token, atau plaintext chat.
- **Catatan Dependency:** Admin Web menampilkan menu audit trail untuk auditor/manajemen.

#### `SEC-HARD-004`: Structured Logging Engine & Automatic Secret/PII Redactor
- **Tujuan:** Memastikan log server (Winston/Pino) terstruktur rapi dan 100% bebas dari kebocoran data sensitif (tokens, passwords, encryption keys, PII).
- **Deskripsi:** Implementasi logger terpusat dengan output JSON terstruktur (`timestamp`, `level`, `context`, `requestId`, `message`, `metadata`). Membuat custom log sanitizer / redactor mask yang otomatis menyamarkan field sensitif:
  - `password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `authorization`, `privateKey`, `secret`, `prekey`, `creditCard`, `signature`.
  - Nilai field tersebut otomatis diganti menjadi `[REDACTED]` sebelum ditulis ke stdout atau log file.
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `BE-CORE-002`
- **Fase:** Phase 14
- **Output:** `AppLoggerService`, Winston/Pino logger setup, regex/object redactor utility.
- **Definition of Done:** Seluruh output log berformat JSON terstruktur; tidak ada password atau token yang bocor di terminal, log file, atau monitoring tool meskipun terjadi unhandled exception.
- **Test Requirement:** Unit test log redactor pada payload bertingkat yang mengandung berbagai variasi nama field sensitif.
- **Security Consideration:** Mencegah kebocoran kredensial melalui log aggregation / SIEM (CWE-532).
- **Catatan Dependency:** Format log disesuaikan dengan log collector di tim DevOps.

#### `SEC-HARD-005`: Dependency Security Review & Automated Vulnerability Scanning
- **Tujuan:** Menjamin seluruh library dependensi backend bebas dari kerentanan keamanan yang diketahui (known CVEs).
- **Deskripsi:** Konfigurasi audit dependensi otomatis menggunakan `npm audit`, `Snyk`, atau `Trivy` pada pipeline. Mengunci file `package-lock.json`. Menghapus library yang abandoned atau tidak terawat. Memverifikasi tidak ada dependensi yang menggunakan custom crypto atau lisensi yang melanggar ketentuan capstone.
- **Priority:** P0
- **Estimasi:** 1 Hari (Review: 4h, Remediation: 4h)
- **Dependensi:** All Phase 0-14 Modules
- **Fase:** Phase 14
- **Output:** Laporan audit dependensi `npm audit`, security report tanpa status High/Critical vulnerabilities.
- **Definition of Done:** `npm audit --audit-level=high` mengembalikan exit code 0 (zero High/Critical vulnerabilities); seluruh dependensi terkunci versinya.
- **Test Requirement:** CI/CD step verifikasi audit dependensi.
- **Security Consideration:** Supply chain attack prevention (OWASP Top 10).
- **Catatan Dependency:** DevOps mengintegrasikan scanning script ke CI pipeline.

---

### PHASE 15: DATA RETENTION & PRIVACY PURGE ENGINE

#### `DATA-PRIV-001`: Master Data Retention, Partitioning & Privacy Purge Policy
- **Tujuan:** Menerapkan jadwal pembersihan (retention purge) otomatis untuk data telemetri, sesi kadaluarsa, token stale, dan log sistem sesuai regulasi privasi.
- **Deskripsi:** Membuat background cron worker (`RetentionPurgeWorker`) yang berjalan setiap malam untuk membersihkan data usang:
  1. `location_points`: Partisi bulanan di-drop / diarsipkan setelah **90 hari**.
  2. `sessions`: Sesi yang telah direvoke atau kedaluwarsa dibersihkan setelah **30 hari**.
  3. `devices.push_token`: Token yang tidak aktif / unlinked dibersihkan setelah **90 hari**.
  4. `messages` (ciphertext envelopes): Histori pesan di-purge setelah **180 hari** (penyimpanan lokal tetap di HP user).
  5. `security_events`: Diarsipkan setelah **365 hari**.
  6. `audit_logs`: Dipertahankan selama **2 tahun** (kebijakan kepatuhan audit).
- **Priority:** P1
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `GPS-ING-003`, `SEC-HARD-003`
- **Fase:** Phase 15
- **Output:** `RetentionModule`, `RetentionPurgeWorker`, skrip DDL partition management.
- **Definition of Done:** Cron job berjalan tanpa mengunci tabel produksi; data koordinat >90 hari terhapus otomatis; volume disk database tetap stabil.
- **Test Requirement:** Unit test simulasi batch deletion data kadaluarsa; verifikasi audit log tidak terhapus sebelum batas 2 tahun.
- **Security Consideration:** Kepatuhan terhadap prinsip *Data Minimization & Storage Limitation* (GDPR / UU PDP).
- **Catatan Dependency:** Koordinasi dengan DevOps terkait kapasitas storage database.

---

### PHASE 16: AUTOMATED TESTING SUITE, CONTRACT TESTS & SECURITY SCANS

#### `TEST-QA-001`: Core Domain & State Machine Unit Test Suite
- **Tujuan:** Memvalidasi seluruh business logic, kalkulasi spasial, dan state machine delivery dengan unit test berkecepatan tinggi.
- **Deskripsi:** Menulis unit test komprehensif menggunakan Jest:
  - Delivery state transitions (valid vs invalid paths).
  - Algoritma optimasi rute (`n <= 5` exhaustive vs `n > 5` 2-Opt heuristic).
  - Logika sanitasi GPS (kecepatan, jarak, filter akurasi).
  - Form validation pipes dan exception handling.
  - Target code coverage: **>= 85% pada core domain services**.
- **Priority:** P0
- **Estimasi:** 3 Hari (Design: 4h, Impl: 16h, Review: 4h)
- **Dependensi:** All Phase 1-6 Modules
- **Fase:** Phase 16
- **Output:** Test files `*.spec.ts`, laporan coverage Jest.
- **Definition of Done:** Seluruh unit test pass (100% green); code coverage pada folder `src/deliveries`, `src/routes`, `src/tracking`, `src/auth` mencapai minimal 85%.
- **Test Requirement:** `npm run test:cov` berhasil tanpa failure.
- **Security Consideration:** Menjamin kestabilan boundary logic terhadap edge-case input.
- **Catatan Dependency:** None.

#### `TEST-QA-002`: Integration Test Suite (Database, Cache & WebSocket Gateways)
- **Tujuan:** Menguji interaksi backend dengan PostgreSQL/PostGIS, Redis, dan WebSocket gateway secara nyata di test container.
- **Deskripsi:** Setup automated integration test environment menggunakan Docker Compose Test DB. Menulis integration test:
  - Auth flow (login, token refresh rotation, reuse detection revocation).
  - Delivery lifecycle end-to-end dengan database commit & rollback.
  - GPS ingestion ➔ PostGIS spatial index query verification.
  - WebSocket authentication handshake dan room subscription isolation.
- **Priority:** P0
- **Estimasi:** 3 Hari (Setup: 6h, Impl: 14h, Review: 4h)
- **Dependensi:** `TEST-QA-001`
- **Fase:** Phase 16
- **Output:** Test files `*.e2e-spec.ts`, test database container setup.
- **Definition of Done:** Seluruh integration test berjalan sukses terhadap PostgreSQL + PostGIS dan Redis riil dalam pipeline test.
- **Test Requirement:** `npm run test:e2e` pass tanpa mock database.
- **Security Consideration:** Validasi integritas transaksi database di bawah kondisi concurrency.
- **Catatan Dependency:** None.

#### `TEST-QA-003`: Automated Security Test Suite (IDOR, Auth Abuse, Upload & Replay)
- **Tujuan:** Membuktikan bahwa seluruh kontrol keamanan backend bekerja efektif melawan simulasi serangan siber.
- **Deskripsi:** Menulis script automated security regression test:
  1. **IDOR / BOLA Testing:** Driver A mencoba read/update delivery Driver B ➔ Expect 403.
  2. **Session Revocation Testing:** Request API dengan token dari akun yang sudah di-disable ➔ Expect 401.
  3. **Brute Force / Rate Limit Testing:** Flooding 20 login salah berturut-turut ➔ Expect 429.
  4. **Replay & Idempotency Testing:** Replay payload mutasi status delivery ➔ Expect cached response tanpa mutasi ganda.
  5. **Malicious Upload Testing:** Upload script PHP berkamuflase JPEG ➔ Expect 400 rejection.
  6. **CSRF & Cookie Testing:** Simulasi mutasi cross-origin pada Admin Web ➔ Expect 403.
  7. **Log Leakage Inspection:** Scanning log file test untuk memastikan tidak ada token/password/plaintext chat.
- **Priority:** P0
- **Estimasi:** 2.5 Hari (Design: 6h, Impl: 10h, Review: 4h)
- **Dependensi:** `TEST-QA-002`, `SEC-HARD-004`
- **Fase:** Phase 16
- **Output:** Suite `test/security/*`, security test report.
- **Definition of Done:** Seluruh 7 skenario security test lolos (pass) dengan bukti laporan log pengujian yang terdokumentasi.
- **Test Requirement:** Security suite berjalan otomatis pada pipeline CI.
- **Security Consideration:** Verifikasi empiris sebelum release gate.
- **Catatan Dependency:** None.

#### `TEST-QA-004`: End-to-End Delivery & Field Journey Simulation Test
- **Tujuan:** Memvalidasi alur bisnis pengiriman lengkap dari awal hingga akhir sesuai perjalanan operasional nyata.
- **Deskripsi:** Membuat skenario E2E test script yang mengeksekusi urutan:
  `Admin creates Driver` ➔ `Driver activates account` ➔ `Owner creates Delivery with 3 stops` ➔ `Owner requests Route Recommendation` ➔ `Owner assigns Driver & Vehicle` ➔ `Driver accepts Delivery` ➔ `Driver sends GPS stream` ➔ `Owner receives live location on WebSocket` ➔ `Driver arrives at Stop 1 (Geofence trigger)` ➔ `Driver uploads POD photo & signature` ➔ `Stop 1 completed` ➔ `Driver completes remaining stops` ➔ `Delivery status becomes COMPLETED` ➔ `Audit log verified`.
- **Priority:** P0
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Review: 4h)
- **Dependensi:** `TEST-QA-003`
- **Fase:** Phase 16
- **Output:** Automated E2E journey test `test/e2e/main-journey.e2e-spec.ts`.
- **Definition of Done:** Alur lengkap berhasil dieksekusi dari awal hingga akhir dengan status database akhir yang konsisten dan valid.
- **Test Requirement:** Main journey test berjalan sukses dalam satu kali eksekusi otomatis.
- **Security Consideration:** Validasi bahwa seluruh titik otorisasi dilewati dengan benar sepanjang siklus hidup pengiriman.
- **Catatan Dependency:** Menjadi baseline verifikasi integrasi dengan tim FE.

#### `TEST-QA-005`: Architecture & API Contract Test (Anti-Drift QA)
- **Tujuan:** Mencegah drift spesifikasi antara backend NestJS dan frontend (Flutter & Admin Web) dengan memvalidasi skema payload terhadap kontrak OpenAPI & JSON Schema.
- **Deskripsi:** Mengimplementasikan contract testing menggunakan **Dredd** / **Prism** / **Jest Schema Matchers** (`jest-json-schema`):
  1. Seluruh response endpoint REST divalidasi terhadap OpenAPI 3.0 specification (`openapi.json`).
  2. Seluruh payload event WebSocket divalidasi terhadap skema event di `06-API-REALTIME.md`.
  3. Mencegah perubahan nama field yang tidak terdokumentasi (misal: `driver_id` vs `driverId`).
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `TEST-QA-002`
- **Fase:** Phase 16
- **Output:** Test suite `test/contract/*`, laporan validasi kontrak OpenAPI & WebSocket.
- **Definition of Done:** 100% endpoint REST dan event WebSocket tervalidasi identik dengan skema kontrak resmi; CI gagal jika terdapat perbedaan tipe data atau property field.
- **Test Requirement:** `npm run test:contract` lolos 100%.
- **Security Consideration:** Mencegah parsing error dan bypass validasi pada client akibat skema tidak seragam.
- **Catatan Dependency:** OpenAPI spec dibagikan ke tim FE untuk auto-generate client SDK.

---

### PHASE 17: INFRASTRUCTURE COORDINATION, OBSERVABILITY & BACKUP

#### `INFRA-OPS-001`: Dockerfile Multi-Stage Build & Production Container Optimization
- **Tujuan:** Menghasilkan container image backend NestJS yang ringan, aman, dan berorientasi produksi.
- **Deskripsi:** Membuat `Dockerfile` multi-stage build (stage: builder ➔ production runner). Menggunakan base image `node:22-alpine` / `node:22-slim`, mengkompilasi TypeScript ke JavaScript bersih, hanya menyertakan `node_modules` produksi (`npm prune --production`), menjalankan aplikasi dengan non-root user (`USER node`), dan mendefinisikan container healthcheck endpoint (`GET /v1/health/liveness`).
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `BE-CORE-001`
- **Fase:** Phase 17
- **Output:** `Dockerfile`, `.dockerignore`, healthcheck controller.
- **Definition of Done:** Docker image berhasil di-build dengan ukuran minimal (< 200MB); container berjalan sebagai non-root; healthcheck endpoint mengembalikan status HTTP 200 OK beserta status koneksi database & Redis.
- **Test Requirement:** Test build container dan verifikasi status healthcheck di Docker.
- **Security Consideration:** Non-root container execution; minimal attack surface image.
- **Catatan Dependency:** Digunakan oleh DevOps untuk deployment Docker Compose di VPS.

#### `INFRA-OPS-002`: Staging Deployment Coordination & Secret Injection Verification
- **Tujuan:** Memastikan aplikasi backend ter-deploy dengan benar pada server VPS staging bersama tim DevOps.
- **Deskripsi:** Berkoordinasi dengan tim DevOps untuk:
  1. Validasi variabel environment di VPS staging (memastikan tidak ada secret dummy/default).
  2. Verifikasi eksekusi migrasi database otomatis saat startup container (`npm run migration:run`).
  3. Verifikasi seed Initial Admin berhasil dijalankan sekali tanpa error.
  4. Verifikasi koneksi ke Cloudflare Reverse Proxy dan origin TLS certificate.
- **Priority:** P0
- **Estimasi:** 1.5 Hari (Coordination: 4h, Verification: 6h, Bugfix: 2h)
- **Dependensi:** `INFRA-OPS-001`
- **Fase:** Phase 17
- **Output:** Backend running on Staging Server (`https://api-staging.domain.com`), deployment checklist.
- **Definition of Done:** API staging aktif, dapat diakses via HTTPS/WSS, database termigrasi penuh, dan Admin pertama dapat login.
- **Test Requirement:** Smoke test seluruh endpoint dasar pada staging environment.
- **Security Consideration:** Menjamin secret staging terisolasi dari repository Git.
- **Catatan Dependency:** Tanggung jawab bersama tim BE/Security dan DevOps/Infra.

#### `INFRA-OPS-003`: Network Boundary Verification: Cloudflare WSS vs TURN DNS-Only Path
- **Tujuan:** Memverifikasi pemisahan jalur jaringan antara lalu lintas web/API dan lalu lintas media WebRTC.
- **Deskripsi:** Melakukan pengujian konektivitas jaringan:
  1. Memverifikasi traffic REST (`api.domain.com`) dan WebSocket (`ws.domain.com`) melewati Cloudflare Proxy (Orange Cloud) dengan proteksi WAF & DDoS.
  2. Memverifikasi traffic STUN/TURN (`turn.domain.com`) menggunakan DNS-Only (Grey Cloud) / Direct L4 port UDP 3478 & 5349, membuktikan bahwa paket media UDP WebRTC tidak terblokir oleh proxy HTTP Cloudflare.
- **Priority:** P0
- **Estimasi:** 1 Hari (Design: 2h, Test: 4h, Documentation: 2h)
- **Dependensi:** `RTC-MEDIA-001`, `INFRA-OPS-002`
- **Fase:** Phase 17
- **Output:** Laporan verifikasi jaringan `REPORT-NETWORK-BOUNDARY.md`.
- **Definition of Done:** Panggilan WebRTC berhasil tersambung antar dua perangkat di jaringan berbeda (NAT traversal) menggunakan TURN relay tanpa kegagalan koneksi Cloudflare.
- **Test Requirement:** Wireshark / network capture verification: paket UDP TURN terkirim langsung ke server TURN.
- **Security Consideration:** Memastikan arsitektur jaringan tidak bergantung pada asumsi salah proxy HTTP.
- **Catatan Dependency:** Dikerjakan bersama tim DevOps/Infra.

#### `INFRA-OPS-004`: Backup & Restore Disaster Recovery Drill
- **Tujuan:** Menguji prosedur pencadangan dan pemulihan database PostgreSQL + PostGIS untuk mitigasi bencana kehilangan data.
- **Deskripsi:** Melakukan drill simulasi disaster recovery bersama DevOps:
  1. Eksekusi script backup database (`pg_dump` dengan kompresi dan enkripsi).
  2. Simulasi kerusakan database di staging environment.
  3. Eksekusi prosedur pemulihan data (`pg_restore`).
  4. Memverifikasi integritas seluruh relasi tabel, indeks GiST spasial, dan data transaksi setelah proses restore selesai.
- **Priority:** P1
- **Estimasi:** 1 Hari (Drill: 4h, Audit: 4h)
- **Dependensi:** `INFRA-OPS-002`
- **Fase:** Phase 17
- **Output:** Dokumen `RUNBOOK-DISASTER-RECOVERY.md`, bukti log sukses restore data.
- **Definition of Done:** Database berhasil dipulihkan 100% tanpa kehilangan integritas relasional maupun data spasial; durasi pemulihan terdokumentasi.
- **Test Requirement:** Automated verification script mengecek row count dan checksum tabel utama pasca-restore.
- **Security Consideration:** File backup wajib dienkripsi at-rest dan aksesnya dibatasi khusus administrator.
- **Catatan Dependency:** Dipimpin oleh tim DevOps didampingi tim BE/Security.

#### `INFRA-OPS-005`: Observability: Terminus Health Checks, Metrics & DB Pool Monitor
- **Tujuan:** Menyediakan visibility menyeluruh terhadap kesehatan container, koneksi database pool, Redis, dan antrean event.
- **Deskripsi:** 
  1. Implementasi `@nestjs/terminus` health checks:
     - `GET /v1/health/liveness`: Cek event loop server.
     - `GET /v1/health/readiness`: Cek konektivitas PostgreSQL, utilisasi DB connection pool (alert jika pool >80%), koneksi Redis, dan sisa memori heap container.
  2. Implementasi middleware metrik (Prometheus / custom metrics exporter):
     - Active WebSocket connections gauge.
     - GPS ingestion throughput (points/sec) counter.
     - External provider latency & error rate histogram (OSRM, Geocoder, FCM).
     - Outbox queue depth gauge.
- **Priority:** P1
- **Estimasi:** 2 Hari (Design: 4h, Impl: 8h, Test: 4h)
- **Dependensi:** `INFRA-OPS-002`
- **Fase:** Phase 17
- **Output:** `HealthModule`, `/v1/health/*` endpoints, `MetricsModule`.
- **Definition of Done:** Health endpoints mengembalikan status JSON akurat; metrik utilisasi pool database dapat dipantau; alert otomatis terpicu jika DB pool jenuh.
- **Test Requirement:** Unit test health checks saat PostgreSQL/Redis sengaja dimatikan (memastikan status `DOWN` terdeteksi presisi).
- **Security Consideration:** Endpoint metrik diproteksi otorisasi / internal network only.
- **Catatan Dependency:** Digunakan oleh DevOps untuk Prometheus/Grafana monitoring dashboard.

#### `INFRA-OPS-006`: Encrypted Backup Pipeline & Disaster Recovery Audit Trail
- **Tujuan:** Memastikan file backup database terenkripsi penuh di storage dan proses pemulihan tercatat di audit trail.
- **Deskripsi:** 
  1. Skrip backup otomatis mengenkripsi dump PostgreSQL menggunakan **AES-256-GCM** (dengan encryption key terpisah dari database) dan menghasilkan checksum **SHA-256**.
  2. Backup disimpan di bucket private khusus backup dengan lifecycle rule 30 hari.
  3. Prosedur restore mewajibkan validasi otorisasi Super Admin dan otomatis mencatat record `DATABASE_RESTORE_EXECUTED` ke audit log permanen.
- **Priority:** P1
- **Estimasi:** 1.5 Hari (Design: 3h, Impl: 6h, Test: 3h)
- **Dependensi:** `INFRA-OPS-004`
- **Fase:** Phase 17
- **Output:** Skrip `backup-encrypted.sh`, `restore-verified.sh`, audit event restore.
- **Definition of Done:** File dump hasil backup tidak terbaca tanpa decryption key; checksum SHA-256 diverifikasi otomatis sebelum restore dijalankan.
- **Test Requirement:** Test enkripsi-dekripsi backup dan deteksi file corrupt saat checksum tidak cocok.
- **Security Consideration:** Mencegah pencurian data sensitif melalui kebocoran file database backup.
- **Catatan Dependency:** Kunci enkripsi backup dikelola oleh DevOps melalui secret management.

---

### PHASE 18: FINAL CONSISTENCY REVIEW & MVP RELEASE GATE

#### `MVP-GATE-001`: OpenAPI / API Contract & Documentation Final Reconciliation
- **Tujuan:** Menyelaraskan seluruh dokumentasi API (OpenAPI/Swagger) dengan implementasi aktual codebase sebelum rilis.
- **Deskripsi:** Generate OpenAPI Specification 3.0 via `@nestjs/swagger` yang mencakup seluruh endpoint, parameter request, DTO response, error codes, dan security schemes (Bearer JWT & Session Cookie). Melakukan audit rekonsiliasi antara isi dokumen `distribution-system-docs/` dengan realitas kode backend; mencatat dan memperbarui perbedaan baseline menjadi dokumentasi final yang presisi.
- **Priority:** P0
- **Estimasi:** 2 Hari (Audit: 6h, Update: 8h, Review: 2h)
- **Dependensi:** All Previous Phases
- **Fase:** Phase 18
- **Output:** Swagger UI aktif (`/v1/docs`), file `openapi.json`, update file dokumentasi project.
- **Definition of Done:** Swagger UI mencerminkan 100% endpoint yang aktif; tidak ada perbedaan tipe data atau status code antara dokumentasi dan implementasi nyata.
- **Test Requirement:** Automated contract validation test (Dredd / Prism contract tester).
- **Security Consideration:** Swagger UI dinonaktifkan atau diproteksi password pada production environment publik.
- **Catatan Dependency:** Swagger spec digunakan tim FE sebagai acuan integrasi final.

#### `MVP-GATE-002`: Final Comprehensive Security, Code & Architecture Audit
- **Tujuan:** Melakukan audit menyeluruh terhadap aspek keamanan, kualitas kode, dan kepatuhan arsitektur backend sebelum rilis MVP.
- **Deskripsi:** Eksekusi checklist audit komprehensif:
  1. Verifikasi zero IDOR/BOLA pada seluruh controller.
  2. Verifikasi zero secret / credentials di dalam git history repository.
  3. Verifikasi log server tidak mengandung token, password, atau plaintext chat/media.
  4. Verifikasi penanganan error graceful saat layanan eksternal (OSRM, Geocoder, Push) mengalami gangguan/timeout.
  5. Verifikasi seluruh automated test suite (Unit, Integration, Security, Contract, E2E) berstatus 100% PASS.
- **Priority:** P0
- **Estimasi:** 2 Hari (Audit: 10h, Verification: 4h, Sign-off: 2h)
- **Dependensi:** `MVP-GATE-001`
- **Fase:** Phase 18
- **Output:** Dokumen `MVP-SECURITY-AUDIT-SIGNOFF.md`.
- **Definition of Done:** Seluruh kriteria dalam Definition of MVP Done terpenuhi tanpa ada temuan critical/high issue yang tertunda; tim BE/Security menandatangani persetujuan rilis.
- **Test Requirement:** Laporan eksekusi seluruh automated test suite terlampir resmi.
- **Security Consideration:** Audit independen sebagai jaminan kualitas sistem.
- **Catatan Dependency:** Sign-off formal untuk presentasi capstone project.

---

## 8. Summary of Estimates & Effort Allocation

| Phase | Nama Fase | Jumlah Task | Total Estimasi (Hari Kerja) | Prioritas Dominan |
|---|---|:---:|:---:|:---:|
| **Phase 0** | Foundation, Arsitektur Modul & Resource Limits | 4 | 6.0 Hari | P0 |
| **Phase 1** | Database Architecture & PostGIS Spasial | 3 | 5.5 Hari | P0 |
| **Phase 2** | Authentication, Session, Device & Transport Strategy | 7 | 12.0 Hari | P0 |
| **Phase 3** | RBAC & Object-Level Authorization Engine | 3 | 5.5 Hari | P0 |
| **Phase 4** | Core Domain & Transactional Event Outbox | 6 | 12.5 Hari | P0 |
| **Phase 5** | Geocoding & Routing Resiliency Subsystem | 4 | 8.0 Hari | P1 |
| **Phase 6** | GPS Ingestion, Validation & Tracking | 4 | 8.0 Hari | P0 / P1 |
| **Phase 7** | Realtime Gateway & WebSocket Infrastructure | 4 | 7.0 Hari | P0 / P1 |
| **Phase 8** | Offline Outbox, Sync & Deterministic Conflict Engine | 3 | 6.5 Hari | P0 / P1 |
| **Phase 9** | Secure File Upload & Proof of Delivery (POD) | 4 | 7.0 Hari | P0 / P1 |
| **Phase 10** | Push Notification & Mobile Wake-Up Bridge | 3 | 6.0 Hari | P1 |
| **Phase 11** | E2EE Feasibility Spike & Messaging Service | 4 | 7.5 Hari | P1 / P2 |
| **Phase 12** | WebRTC Signaling, PTT & Owner Video | 3 | 6.5 Hari | P1 / P2 |
| **Phase 13** | Emergency SOS & Security Telemetry | 2 | 2.5 Hari | P0 / P1 |
| **Phase 14** | Security Hardening, Audit & Anti-Abuse | 5 | 8.0 Hari | P0 |
| **Phase 15** | Data Retention & Privacy Purge Engine | 1 | 2.0 Hari | P1 |
| **Phase 16** | Automated Testing Suite & Contract Tests | 5 | 12.0 Hari | P0 |
| **Phase 17** | Infrastructure Coordination, Observability & Backup | 6 | 8.5 Hari | P0 / P1 |
| **Phase 18** | Final Verification & MVP Release Gate | 2 | 4.0 Hari | P0 |
| **TOTAL** | **Seluruh Siklus Backend & Security** | **73 Tasks** | **~137 Hari Efektif / Man-Days** | **Enterprise Hardened** |

---

## 9. Data Retention & Privacy Matrix

| Kategori Data | Tabel Database | Periode Retensi Aktif | Tindakan Pasca Retensi | Justifikasi Kepatuhan & Keamanan |
|---|---|:---:|:---:|---|
| **Telemetri GPS Mentah** | `location_points` | 30 Hari | Partisi bulanan di-drop / diarsipkan ke cold storage setelah 90 hari | Meminimalkan risiko pelacakan historis driver dan menghemat disk. |
| **Delivery & Item Transaksi** | `deliveries`, `delivery_items` | 5 Tahun | Diarsipkan permanen (Read-Only) | Kepatuhan hukum pajak dan audit pembukuan perusahaan. |
| **Destinasi & Stops** | `delivery_stops` | 5 Tahun | Diarsipkan permanen | Rekam jejak pengiriman barang. |
| **File Bukti Pengiriman (POD)** | `proof_of_delivery`, `files` | 1 Tahun | Dipindahkan ke cold storage S3 Glacier (maks 3 tahun) | Perlindungan klaim sengketa pengiriman barang. |
| **Pesan Chat (Ciphertext)** | `messages`, `conversations` | 180 Hari | Dihapus dari server (riwayat tetap tersimpan di device HP) | Privasi komunikasi dan mitigasi risiko server compromise. |
| **Kunci Sesi E2EE (Prekeys)** | `device_keys` | Selama aktif | One-time prekey dihapus seketika setelah dikonsumsi | Keamanan Forward Secrecy protokol perpesanan. |
| **Sesi User & Device** | `sessions`, `devices` | 30 Hari pasca revoke | Record sesi dihapus permanen dari PostgreSQL & Redis | Membersihkan sampah sesi mati dan menjaga performa DB. |
| **Device Push Tokens** | `devices.push_token` | Selama aktif | Dihapus seketika saat token dinyatakan invalid oleh FCM/APNs | Mencegah kebocoran notifikasi ke pemilik baru perangkat lama. |
| **Audit Logs** | `audit_logs` | 2 Tahun | Dipertahankan tanpa modifikasi (Append-Only) | Kepatuhan investigasi insiden dan forensik keamanan. |
| **Security Events** | `security_events` | 1 Tahun | Diarsipkan ke cold log storage | Analisis tren ancaman dan brute force pattern. |
| **Log Aplikasi (Stdout/Files)** | Winston / Pino JSON Logs | 14 Hari (Staging) / 30 Hari (Prod) | Log rotation & automated deletion | Mencegah kebocoran data dan disk exhaustion di VPS. |

---

## 10. Remaining Technical Spikes & ADR Registry

| ADR / Spike ID | Topik Evaluasi | Pertanyaan Utama yang Dijawab | Target Fase |
|---|---|---|:---:|
| **`ADR-001`** | **ORM Selection** | Apakah Prisma (dengan custom SQL PostGIS) atau Drizzle ORM yang lebih stabil untuk spatial queries dan migration rollback? | Phase 0 |
| **`ADR-002`** | **E2EE Feasibility & Protocol** | Apakah library `libsignal_protocol_dart` / Olm lolos uji kompilasi dan key generation di Flutter Android & iOS? | Phase 11 |
| **`ADR-003`** | **Admin Auth Transport** | Konfigurasi final HttpOnly Secure Cookie + CSRF protection vs In-memory token + strict CSP untuk Admin Web? | Phase 2 |
| **`ADR-004`** | **JWT Signing Evaluation** | Dokumentasi trade-off HS256 baseline vs asymmetric RS256 jika ada kebutuhan integrasi external verifier? | Phase 2 |
| **`ADR-005`** | **Malware Scanning Strategy** | Asynchronous quarantine queue vs decoupled cloud scanner untuk menghemat RAM 2 GB? | Phase 9 |

---

## 11. Definition of "MVP Done" (Final Release Gate Checklist)

MVP **hanya boleh dinyatakan SELESAI (DONE)** jika seluruh kriteria verifikasi di bawah ini telah terpenuhi secara empiris dengan bukti pengujian nyata:

- [ ] **Core Journey Terverifikasi:** Admin provisioning akun ➔ Owner create delivery & rute ➔ Driver accept ➔ GPS terkirim & live di peta Owner ➔ POD di-upload ➔ Delivery selesai.
- [ ] **Zero Known Blocking Bugs:** Tidak ada error unhandled 500, data corruption, atau impossible state pada seluruh alur utama.
- [ ] **IDOR & BOLA Defense Lolos Uji:** Pengujian penetrasi internal membuktikan driver tidak dapat membaca atau memodifikasi data pengiriman driver lain.
- [ ] **Autentikasi & Session Teruji:** Password ter-hash Argon2id (stabil pada RAM 2 GB); JWS signature terverifikasi ketat; token refresh berotasi dengan aman; pencabutan akun/sesi langsung memutus akses API & WebSocket seketika.
- [ ] **Integritas GPS Terverifikasi:** Filter kecepatan, akurasi, dan timestamp berhasil menolak koordinat palsu / anomali tanpa mematikan sistem.
- [ ] **Realtime WebSocket Andal:** Fan-out lokasi berjalan lancar dengan throttling; room terisolasi antar tenant; pemutusan koneksi terdeteksi presisi; transactional outbox menjamin zero event loss.
- [ ] **Offline & Idempotency Teruji:** Request mutasi yang dikirim berulang kali saat koneksi buruk tidak menghasilkan duplikasi transaksi; benturan status tercatat di tabel konflik dengan *Deterministic Authority Matrix* tanpa kehilangan bukti POD.
- [ ] **Keamanan File Upload Teruji:** Validasi magic bytes aktif; file tersimpan di storage privat; URL unduhan menggunakan pre-signed token berdurasi pendek.
- [ ] **Komunikasi Terproteksi:** WebRTC media terenkripsi via DTLS-SRTP; signaling terotentikasi dengan session nonce anti-replay; tidak ada plaintext media/chat yang bocor di log server.
- [ ] **Proteksi Anti-Abuse Aktif:** Rate limiting aktif di seluruh endpoint sensitif; security headers (Helmet) & CORS allowlist aktif; DTO whitelist menolak mass assignment.
- [ ] **Sanitasi Log Terbukti:** Tidak ada password, JWT token, kredensial TURN, atau kunci enkripsi yang muncul di file log.
- [ ] **Automated Test Suite 100% Pass:** Seluruh Unit Test (coverage >= 85%), Integration Test, Security Test, Contract Test, dan E2E Journey Test berstatus hijau (PASS).
- [ ] **Observability & Backup Teruji:** Endpoint health check `/v1/health/*` aktif; database backup terenkripsi AES-256 dan drill pemulihan berhasil 100%.
- [ ] **Dokumentasi Sinkron:** OpenAPI/Swagger spec mencerminkan 100% kontrak API aktual yang berjalan di server.
- [ ] **Sign-off Security & Architecture Audit:** Seluruh poin audit pada task `MVP-GATE-002` telah ditandatangani.

---
*Dokumen ini merupakan baseline eksekusi resmi untuk tim Backend & Security. Setiap perubahan arsitektur atau keputusan teknologi wajib diperbarui melalui Architecture Decision Record (ADR) dan disinkronkan ke dalam dokumen ini.*
