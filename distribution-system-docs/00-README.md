# Distribution Management System — Project Documentation

## 1. Ringkasan

Dokumentasi ini mendefinisikan sistem distribusi internal perusahaan yang menghubungkan **Admin**, **Owner**, dan **Driver** melalui satu backend. Tidak ada customer-facing application pada baseline project.

Platform:

- **Owner Mobile App** — monitoring armada, delivery management, route, komunikasi, dan laporan.
- **Driver Mobile App** — menjalankan delivery, menerima/menentukan route, mengirim GPS dari smartphone, proof of delivery, dan komunikasi.
- **Admin Web** — administrasi user, kendaraan, konfigurasi, audit, security, dan tindakan tingkat sistem.
- **Backend/API** — pusat authentication, authorization, delivery, tracking, realtime, messaging, routing, audit, notification, dan integration.

## 2. Prinsip arsitektur utama

1. HP driver menjadi sumber utama GPS/location telemetry karena kendaraan tidak memiliki GPS tracker/IoT.
2. Backend menjadi source of truth untuk state bisnis, authorization, delivery, route, dan audit.
3. Owner dan Driver memakai aplikasi mobile yang terpisah.
4. Admin memakai Web karena workload administrasi lebih cocok untuk desktop.
5. Role/permission wajib ditegakkan di backend; pembatasan UI bukan security boundary.
6. REST digunakan untuk transaksi; WebSocket untuk business realtime; WebRTC untuk voice/video.
7. Chat, voice, dan video memiliki security requirement yang lebih kuat daripada sekadar TLS; private communication dirancang dengan endpoint/application-level encryption.
8. Maps, routing, media infrastructure, ORM, dan provider eksternal dibuat replaceable di integration layer bila masuk akal.
9. MVP memprioritaskan delivery lifecycle dan tracking sebelum fitur media realtime yang lebih berat.
10. Project menggunakan modular monolith terlebih dahulu; microservice hanya bila ada kebutuhan nyata.

## 3. Role

| Role | Platform | Fokus |
|---|---|---|
| Admin | Web | User/system management, security, audit, override |
| Owner | Mobile | Fleet/distribution operation & monitoring |
| Driver | Mobile | Delivery execution & field operation |

### Account lifecycle

```text
Bootstrap
   ↓
Initial Admin
   ↓
Admin creates Owner / Driver
   ↓
Driver activation
   ↓
Login
```

Owner dapat membuat Driver bila permission tersebut diaktifkan. Owner tidak dapat membuat atau menaikkan user menjadi Admin.

## 4. Scope baseline

### In scope

- authentication/session
- RBAC dan object-level authorization
- Admin Web
- Owner Mobile
- Driver Mobile
- delivery/item/destination management
- driver/vehicle assignment
- manual, recommended, automatic route mode
- GPS tracking dari smartphone Driver
- location history
- realtime fleet monitoring
- geofence support
- chat
- push-to-talk
- Owner-requested video
- E2EE/security controls
- proof of delivery
- notification
- emergency/SOS
- audit log
- structured/error/security logging
- maps/routing integration
- observability dan deployment

### Out of scope baseline

- customer account/application
- vehicle IoT/GPS tracker
- fuel/engine/temperature sensor
- public marketplace
- payment gateway
- fully autonomous dispatch
- custom cryptographic algorithm

## 5. Technology baseline

### Confirmed / recommended baseline

- Flutter — Owner Mobile + Driver Mobile
- Admin Web
- TypeScript + Node.js LTS + NestJS — backend baseline
- PostgreSQL (+ PostGIS when geospatial features require it)
- Redis — cache/pubsub/realtime support
- REST/HTTPS
- WebSocket
- WebRTC
- Docker
- Linux LTS
- Cloudflare at edge
- JWT + refresh-token strategy
- strict schema validation
- RBAC
- audit + structured logging

### Evaluation / TBD

- ORM final: Prisma / Drizzle / TypeORM
- Map provider
- Mobile map renderer
- Routing engine
- Self-hosted vs external routing
- WebRTC SFU topology if needed
- Object storage provider
- Final VPS provider/size

## 6. Mapping direction

Untuk keterbatasan biaya mahasiswa, **OpenStreetMap-based mapping** menjadi preferred direction untuk dievaluasi.

Pemisahan concern:

```text
Map data / tiles
      ↓
Map renderer
      ↓
Routing engine
      ↓
Backend route-optimization logic
```

Candidate:

- Web/Admin: Leaflet
- Mobile: Flutter-compatible OSM map library
- Routing: OSRM
- Alternative: openrouteservice atau provider lain
- Google Maps: fallback/alternative bila hasil evaluasi coverage, reliability, traffic, UX, atau biaya lebih cocok.

Provider wajib diabstraksikan sehingga pergantian provider tidak memaksa perubahan domain logic.

## 7. Infrastruktur awal

Development dapat berjalan pada PC lokal.

Capstone demo/staging cost-aware baseline:

```text
2 vCPU
2 GB RAM
30 GB SSD/NVMe
Linux LTS
Docker
```

Recommended headroom:

```text
2–4 vCPU
4 GB RAM
40–60 GB SSD/NVMe
```

Self-hosted OSRM harus divalidasi berdasarkan wilayah data dan preprocessing; jangan menganggap 15 GB storage cukup untuk semua skenario.

## 8. Dokumentasi

- `01-PRD.md` — Product Requirements
- `02-SRS.md` — Software Requirements
- `03-DFD.md` — Data Flow Diagram & business flow
- `04-SYSTEM-ARCHITECTURE.md` — logical/deployment architecture
- `05-DOMAIN-DATA-MODEL.md` — domain/ERD/state
- `06-API-REALTIME.md` — API, realtime, GPS, maps, media contract
- `07-SECURITY-RBAC.md` — security, RBAC, E2EE, audit/logging
- `08-TESTING-DEPLOYMENT-ROADMAP.md` — testing, CI/CD, infrastructure, roadmap
- `09-PROJECT-FLOW.md` — end-to-end project flow
- `10-TEAM-RESPONSIBILITY.md` — FE/UIUX, BE/Security, Infrastructure/DevOps
- `11-TECHNOLOGY-STACK-INFRASTRUCTURE.md` — technology/provider/VPS decision record

## 9. Decision discipline

Dokumen membedakan:

- **Confirmed** — telah menjadi baseline.
- **Required** — wajib dipenuhi tetapi implementasi dapat dipilih.
- **Recommended** — arah pilihan saat ini.
- **Evaluation/TBD** — belum boleh dianggap keputusan final.

Setiap keputusan teknologi besar yang mengubah cost, security, operational model, atau architecture harus dicatat pada decision record.

## 10. Backend/Security scope clarification

Tim BE/Security bertanggung jawab atas seluruh security behavior dan backend enforcement, termasuk authentication/session, JWT access/refresh token, RBAC/object-level authorization, API validation, rate limiting, CORS policy, ORM/parameterized query usage, GPS validation, WebSocket authorization, messaging, E2EE integration, WebRTC signaling, upload security, audit/security logging, secret handling, device/session revocation, idempotency, anti-replay controls, dan security testing. Infrastruktur seperti VPS, firewall, reverse proxy, Cloudflare, TURN/STUN, CI/CD, serta host monitoring tetap dikerjakan bersama BE tetapi dimiliki tim Infrastructure/DevOps pada layer operasional.

## 11. Additional security principles

- Session dan device harus dapat direvoke secara individual atau seluruhnya.
- Authorization harus memverifikasi kepemilikan/scope resource, bukan hanya role.
- Critical command harus idempotent dan tahan replay/duplicate submission.
- Upload file harus divalidasi, diisolasi, dan hanya dapat diakses oleh pihak berwenang.
- GPS harus divalidasi untuk stale timestamp, outlier, accuracy, dan lompatan posisi tidak masuk akal.
- Push notification tidak boleh membocorkan data sensitif pada lock screen.
- Log harus structured dan tersanitasi; secret, token, private key, plaintext E2EE, dan media sensitif tidak boleh masuk log.
- Tidak boleh ada custom cryptography.



## 6. New implementation constraints

- PostGIS `geometry(Point, 4326)` dan GiST spatial index menjadi baseline untuk spatial queries.
- Routing exhaustive hanya untuk <=5 stops; jumlah lebih besar wajib memakai heuristik/engine-assisted path.
- TURN/STUN diperlakukan sebagai network path terpisah dari ordinary Cloudflare HTTP proxying.
- Background GPS dan call wake-up harus mengikuti lifecycle/permission policy Android/iOS.
