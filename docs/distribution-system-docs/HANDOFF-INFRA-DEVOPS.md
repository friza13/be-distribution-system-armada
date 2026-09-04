# Infrastructure & DevOps Handoff Guide

**Document Version:** 1.0.0 (Master Handoff Baseline)  
**Milestone:** Phase 18 Final API Documentation & Handoff Gate  
**Date:** 2026-09-03  
**Target Audience:** Infrastructure Engineers, DevOps, System Administrators, Security Auditors  
**Repository Commit Audited:** `840dfd6` (Runtime Source of Truth)

---

## 1. System Architecture & Deployment Topology

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ EXTERNAL TRAFFIC (INTERNET)                                                            │
│ ┌───────────────────────┐   ┌───────────────────────┐   ┌────────────────────────────┐ │
│ │ Owner Mobile Client   │   │ Driver Mobile Client  │   │ Admin Web SPA Browser      │ │
│ └───────────┬───────────┘   └───────────┬───────────┘   └─────────────┬──────────────┘ │
└─────────────│───────────────────────────│─────────────────────────────│────────────────┘
              │                           │                             │
              ▼                           ▼                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ CLOUDFLARE EDGE NETWORK (PROXIED HTTP / WSS TRAFFIC)                                   │
│ ├── WAF Rules, DDoS Protection, Rate Limiting, Origin SSL                              │
│ └── DNS-Only / Direct L4 Path for Coturn TURN/STUN Media Traffic (Ports 3478/5349)     │
└─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │ HTTPS / WSS Proxy
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ VPS HOST SERVER / REVERSE PROXY                                                         │
│ ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ NGINX REVERSE PROXY & SSL TERMINATION (Port 443 / 80)                              │ │
│ │ ├── Blocks public direct access to /app/storage                                    │ │
│ │ ├── Upgrades WebSocket connections (/realtime)                                     │ │
│ │ └── Proxies API traffic to http://127.0.0.1:3000                                   │ │
│ └───────────────────────────────────────┬────────────────────────────────────────────┘ │
│                                         │                                              │
│ ┌───────────────────────────────────────▼────────────────────────────────────────────┐ │
│ │ DOCKER COMPOSE PRODUCTION STACK (docker-compose.prod.yml)                          │ │
│ │ ┌────────────────────────────────────────────────────────────────────────────────┐ │ │
│ │ │ NestJS Backend Container (dms_backend_prod) — Port 3000                        │ │ │
│ │ │ ├── Non-root execution (USER node)                                             │ │ │
│ │ │ ├── Terminus Health Indicators (/v1/health/liveness, /v1/health/readiness)     │ │ │
│ │ │ └── Winston/Pino JSON Sanitized Logs                                           │ │ │
│ │ └──────────────┬──────────────────────────┬──────────────────────────┬───────────┘ │ │
│ │                │                          │                          │             │ │
│ │ ┌──────────────▼─────────────┐ ┌──────────▼──────────────┐ ┌──────────▼──────────┐ │ │
│ │ │ PostgreSQL 16 + PostGIS 3.4│ │ Redis 7 Alpine           │ │ Private POD Storage │ │ │
│ │ │ (dms_postgres_prod)        │ │ (dms_redis_prod)         │ │ Volume Mapping      │ │ │
│ │ │ Port 5432 (127.0.0.1)      │ │ Port 6379 (127.0.0.1)     │ │ ./storage           │ │ │
│ │ └────────────────────────────┘ └──────────────────────────┘ └─────────────────────┘ │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Service Topology & Resource Allocation

| Service Component | Container Image / Software | Container Name | Host Port | Internal Port | Persistent Volume |
|:--- |:--- |:--- |:---:|:---:|:--- |
| **Backend API** | Node.js 22 Alpine (Multi-stage `Dockerfile`) | `dms_backend_prod` | `127.0.0.1:3000` | `3000` | `./storage:/app/storage`, `./backups:/app/backups` |
| **Database** | `postgis/postgis:16-3.4-alpine` | `dms_postgres_prod` | `127.0.0.1:5432` | `5432` | `postgres_data_prod:/var/lib/postgresql/data` |
| **Cache & Pub/Sub**| `redis:7-alpine` | `dms_redis_prod` | `127.0.0.1:6379` | `6379` | `redis_data_prod:/data` |
| **Reverse Proxy** | Nginx Mainline / Alpine | System / Nginx | `80`, `443` | - | Nginx SSL certs & `nginx.conf` |

---

## 3. Docker & Docker Compose Specification

### 3.1 Multi-Stage `Dockerfile` (`backend/Dockerfile`)
- **Stage 1 (Builder):** Uses `node:22-alpine`, installs dependencies, runs `npx prisma generate`, compiles TypeScript (`npm run build`).
- **Stage 2 (Production Runner):** Uses `node:22-alpine`, copies production `node_modules` and compiled `dist/`, runs as non-root user `USER node`.
- **Healthcheck:** Defined via `CMD wget --no-verbose --tries=1 --spider http://localhost:3000/v1/health/liveness || exit 1`.

### 3.2 Production Compose (`backend/docker-compose.prod.yml`)
- PostgreSQL, Redis, and Backend services configured with `restart: unless-stopped`.
- PostgreSQL healthcheck: `pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}`.
- Redis healthcheck: `redis-cli ping`.
- Backend startup waits for `postgres` and `redis` services to achieve `service_healthy` condition.

---

## 4. Complete Environment Variables Matrix

All environment variables verified from `backend/src/config/configuration.ts` and `docker-compose.prod.yml`:

| Variable Name | Required | Target Service | Secret? | Default / Example Value | Description |
|:--- |:---:|:--- |:---:|:--- |:--- |
| `NODE_ENV` | Yes | Backend | No | `production` | Node environment profile |
| `PORT` | Yes | Backend | No | `3000` | Backend API HTTP listen port |
| `API_PREFIX` | Yes | Backend | No | `v1` | Global API routing prefix |
| `DATABASE_URL` | Yes | Backend | **Yes** | `postgresql://dms_user:secret@postgres:5432/distribution_db?schema=public` | PostgreSQL PostGIS connection string |
| `POSTGRES_DB` | Yes | Postgres | No | `distribution_db` | Database name |
| `POSTGRES_USER` | Yes | Postgres | No | `dms_user` | Database user |
| `POSTGRES_PASSWORD` | Yes | Postgres | **Yes** | Required in production | Database password |
| `REDIS_HOST` | Yes | Backend | No | `redis` | Redis container hostname |
| `REDIS_PORT` | Yes | Backend | No | `6379` | Redis listen port |
| `JWT_SECRET_OR_KEY` | Yes | Backend | **Yes** | Required (min 512 bits) | HS256 JWT signature secret |
| `BACKUP_ENCRYPTION_KEY`| Yes | Backup Script | **Yes** | Required (min 32 chars) | AES-256-CBC database dump encryption key |
| `CORS_ALLOWED_ORIGINS` | Yes | Backend | No | `https://admin.domain.com,https://owner.domain.com` | Strict CORS origin allowlist |
| `TURN_SHARED_SECRET` | Optional | Backend | **Yes** | Ephemeral TURN HMAC Secret | Secret for generating Coturn credentials |

---

## 5. Secret Management Policy

1. **Zero Secret Policy:** Production secrets must NEVER be committed to Git repositories or written to Dockerfiles.
2. **Environment Injection:** Inject secrets into `docker-compose.prod.yml` using system environment variables or a protected `.env` file on the VPS (file permissions `chmod 600 .env`).
3. **Log Masking:** Winston/Pino logger automatically sanitizes keys (`password`, `accessToken`, `refreshToken`, `authorization`, `privateKey`, `secret`, `prekey`) to `[REDACTED]`.

---

## 6. PostgreSQL 16 + PostGIS 3.4 Architecture & Migrations

- **Image:** `postgis/postgis:16-3.4-alpine`
- **Extensions Enabled:** `CREATE EXTENSION IF NOT EXISTS postgis;`
- **Automated Migration Command:** Executed during deployment container startup:
  ```bash
  npx prisma migrate deploy
  ```
- **Spatial Expression Indexes:** GiST Index `CREATE INDEX idx_delivery_stops_geog ON delivery_stops USING GIST (((geom)::geography));` for true geodesic meter queries.
- **Partitioning:** Monthly range partitioning on `location_points` based on `recorded_at` timestamp.

---

## 7. Redis 7 Configuration & Subsystems

Redis handles 5 distinct application workloads:
1. **Instant Session Revocation Store:** `security:revocation` channels and token blacklist keys.
2. **Rate Limiting Counter Store:** `@nestjs/throttler` backend store.
3. **Latest Driver Location Cache:** Redis Hash `driver:latest_location:{driverId}` (TTL 24h).
4. **WebSocket Pub/Sub Adapter:** Redis adapter for multi-instance Socket.IO fan-out.
5. **Anti-Replay Nonce Store:** WebRTC session nonces (TTL 60s).

---

## 8. Persistent Storage & Nginx Exposure Rules

### 8.1 Volume Mapping
- `./storage:/app/storage`: Stores uploaded Proof of Delivery (POD) photos and signatures (`storage/private/pod/`).
- `./backups:/app/backups`: Stores encrypted database backup dumps (`.sql.gz.enc`).

### 8.2 Nginx Exposure Rule (Security Boundary)
Nginx MUST NOT serve direct static file access to `/app/storage` or `/storage`. All downloads are routed through authorized NestJS stream proxy `GET /v1/files/:id/download`.

Sample `nginx.conf`:
```nginx
server {
    listen 443 ssl http2;
    server_name api.domain.com;

    # Block public access to private file storage
    location /storage/ {
        deny all;
        return 404;
    }

    # Proxy REST API requests
    location /v1/ {
        proxy_pass http://127.0.0.1:3000/v1/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Proxy WebSocket connections
    location /realtime {
        proxy_pass http://127.0.0.1:3000/realtime;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## 9. Cloudflare Edge Proxy & Media Network Boundary

- **REST API (`api.domain.com`) & WebSocket (`ws.domain.com`):** Proxied through Cloudflare (Orange Cloud enabled). WAF rules, HTTPS termination, and WebSocket support active.
- **WebRTC TURN/STUN (`turn.domain.com`):** DNS-Only / Grey Cloud path. Coturn UDP traffic (Ports 3478 & 5349) MUST NOT be routed through Cloudflare HTTP proxies, as standard Cloudflare HTTP proxies do not proxy raw UDP media relays.

---

## 10. Health Observability & Liveness / Readiness Probes

### 10.1 Liveness Probe (`GET /v1/health/liveness`)
- **Status:** Public
- **Purpose:** Verifies process event loop responsiveness.
- **Output:** `{ "status": "ok", "uptime": 3600, "timestamp": "..." }`

### 10.2 Readiness Probe (`GET /v1/health/readiness`)
- **Status:** Public (Uses `@nestjs/terminus`)
- **Deep Diagnostics Checked:**
  1. PostgreSQL Database ping (`prismaIndicator.pingCheck`)
  2. Redis Cache ping (`redisIndicator.isHealthy`)
  3. POD Storage write accessibility (`storageIndicator.isHealthy`)
  4. Memory Heap consumption (<500 MB limit)
- **Failure Status Code:** `503 Service Unavailable` if PostgreSQL or Redis is down.

---

## 11. Database Backup & Disaster Recovery Pipeline

Repository includes verified shell scripts in `scripts/`:

### 11.1 Backup Execution Script (`scripts/backup-db.sh`)
- **Command:** Executed via cron or manually.
- **Process:** Runs `pg_dump`, compresses with `gzip`, encrypts using OpenSSL AES-256-CBC (`openssl enc -aes-256-cbc -pbkdf2 -pass pass:${BACKUP_ENCRYPTION_KEY}`), generates SHA-256 checksum file.
- **Output File:** `backups/db_backup_YYYYMMDD_HHMMSS.sql.gz.enc`

### 11.2 Restore Execution Script (`scripts/restore-db.sh`)
- **Command:** `bash scripts/restore-db.sh backups/db_backup_...sql.gz.enc`
- **Process:** Verifies SHA-256 checksum, decrypts via OpenSSL AES-256-CBC, decompresses, and restores SQL dump into PostgreSQL.

---

## 12. WebRTC Coturn TURN Server Configuration

- **Software:** Coturn TURN/STUN Server (`coturn`)
- **Ports Required:** `3478/UDP`, `3478/TCP`, `5349/UDP` (TURNS SSL)
- **Credential Validation Mode:** `use-auth-secret` (Shared Secret HMAC-SHA1 algorithm).
- **Backend Compatibility:** NestJS `TurnCredentialService` generates short-lived credentials matching Coturn shared secret:
  `username = timestamp:userId`, `password = Base64(HMAC-SHA1(secret, username))`.

---

## 13. Production Readiness Checklist

- [x] Multi-stage Dockerfile configured with non-root user `node`
- [x] Docker Compose stack (`docker-compose.prod.yml`) verified
- [x] Health readiness probe (`/v1/health/readiness`) verified
- [x] AES-256 database backup & restore pipeline verified
- [x] Nginx reverse proxy SSL & `/storage` public block configured
- [ ] Physical VPS server deployment executed (Operational Launch Step)
- [ ] Real FCM/APNs push certificates injected (Mobile Launch Step)
- [ ] Coturn TURN server physical deployment & DNS-only routing verified (Media Launch Step)

---

## 14. Verification Evidence & Unresolved Gaps

### Verification Evidence:
- **Repository HEAD Commit:** `840dfd6`
- **Audited Files:** `backend/Dockerfile`, `backend/docker-compose.prod.yml`, `backend/nginx/nginx.conf`, `scripts/backup-db.sh`, `scripts/restore-db.sh`, `backend/src/modules/health/health.controller.ts`.
- **Unit Test Evidence:** `test/deployment/deployment-stack.spec.ts` (PASS), `test/storage/storage-backup.spec.ts` (PASS).
- **Compilation Status:** `npm run build` exit code 0.

### Unresolved Operational Gaps (Explicitly Marked):
- **Physical VPS Deployment:** Status: `NOT VERIFIED`. (The container stack is structurally verified via unit tests, but actual physical deployment to a target VPS IP is an operational release step).
- **Production FCM/APNs Delivery:** Status: `NOT VERIFIED`. (FCM push provider mock is verified in E2E tests, but live push delivery to physical smartphones requires mobile app APNs/FCM credentials).
- **Coturn Cellular NAT Traversal:** Status: `NOT VERIFIED`. (TURN ephemeral HMAC token generation is verified, but real cellular NAT traversal requires physical TURN server setup).
