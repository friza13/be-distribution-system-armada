# Distribution Management System — Backend

This repository contains the standalone backend service for the **Distribution Management System (Armada)** capstone project.

---

## 1. Repository Architecture & Scope

This project is organized under a **Polyrepo / Multi-Repository Architecture**. This repository contains the **Backend API & Realtime Gateway only**.

### System Repositories Overview:
- **Backend API & Realtime Service:** This repository (`be-distribution-system-armada`)
- **Admin Web Client:** Separate repository
- **Owner Mobile Client:** Separate repository
- **Driver Mobile Client:** Separate repository

Client applications interact with this backend strictly through documented network contract boundaries (REST API and WebSocket protocols) and do not share source code within this repository.

```text
                           ┌────────────────────────┐
                           │   Backend Repository   │
                           │   (This Repository)    │
                           └───────────┬────────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            │ REST (OpenAPI 3.0)       │ REST (OpenAPI 3.0)       │ REST & Cookie CSRF
            │ WebSocket (/v1/realtime) │ WebSocket (/v1/realtime) │ WebSocket (/v1/realtime)
            ▼                          ▼                          ▼
  ┌───────────────────┐      ┌───────────────────┐      ┌───────────────────┐
  │   Owner Mobile    │      │   Driver Mobile   │      │     Admin Web     │
  │   (Separate Repo) │      │   (Separate Repo) │      │   (Separate Repo) │
  └───────────────────┘      └───────────────────┘      └───────────────────┘
```

---

## 2. Technology Baseline

- **Runtime:** Node.js 22 LTS
- **Framework:** NestJS 10 (TypeScript) — Modular Monolith design internally
- **Database:** PostgreSQL 16 with PostGIS 3.4 spatial extension
- **ORM:** Prisma ORM 5.22.0 (Strictly Pinned)
- **Cache & Pub/Sub:** Redis 7 (ioredis client with dedicated data and subscriber connections)
- **Realtime Gateway:** Socket.IO v4 (Namespace: `/v1/realtime`)
- **Routing Engine:** OSRM HTTP API v5 with in-memory Haversine geodesic failover and 2-Opt TSP optimization
- **Communication Security:** E2EE Ciphertext Relay (Signal Protocol family) and WebRTC PTT/Video Signaling (RFC 7635 Ephemeral TURN)

---

## 3. Repository Directory Structure

```text
distribution-system-armada/
├── src/                                  # NestJS Modular Monolith Application Source
│   ├── modules/                          # Domain Modules (auth, deliveries, routes, etc.)
│   ├── common/                           # Filters, Interceptors, Guards, Prisma, Redis
│   └── config/                           # Configuration & Environment Validation
├── prisma/                               # PostgreSQL + PostGIS Schema & Migrations
├── test/                                 # Unit & E2E Automated Test Suites (51 suites, 227 tests)
├── scripts/                              # Utility & Automation Scripts (backup, restore, smoke test)
├── storage/                              # Local Private Storage (POD uploads, git-ignored)
├── backups/                              # Encrypted Database Backup Directory (git-ignored)
│
├── docs/                                 # Central Documentation Root
│   ├── distribution-system-docs/         # Canonical System Architecture, Contracts & Handoffs
│   │   ├── 00-README.md                  # Project overview & architectural principles
│   │   ├── 01-PRD.md                     # Product Requirements Document
│   │   ├── 02-SRS.md                     # Software Requirements Specification
│   │   ├── 03-DFD.md                     # Data Flow Diagrams
│   │   ├── 04-SYSTEM-ARCHITECTURE.md     # System Topology & Security Boundaries
│   │   ├── 05-DOMAIN-DATA-MODEL.md       # Relational & Spatial Data Models
│   │   ├── 06-API-REALTIME.md            # WebSocket / Realtime Protocol Contract
│   │   ├── 07-SECURITY-RBAC.md           # Security Policy & RBAC Matrix
│   │   ├── 08-TESTING-DEPLOYMENT-ROADMAP.md # Testing & Release Roadmaps
│   │   ├── 09-PROJECT-FLOW.md            # End-to-End Business Journey
│   │   ├── 10-TEAM-RESPONSIBILITY.md     # Team Responsibilities & Boundaries
│   │   ├── 11-TECHNOLOGY-STACK-INFRASTRUCTURE.md # Tech Stack Decision Records
│   │   ├── API-ENDPOINTS.md              # Master Index of all 59 REST Routes
│   │   ├── HANDOFF-FE.md                 # Frontend Team Integration Handoff
│   │   ├── HANDOFF-INFRA-DEVOPS.md       # DevOps Team Infrastructure Handoff
│   │   ├── api/                          # Domain-specific living API contracts
│   │   └── openapi/                      # OpenAPI 3.0 specification (openapi.yaml)
│   ├── reports/                          # Audit & Verification Reports (Phase 0 - 18)
│   └── superpowers/                      # Architecture Specs & Implementation Plans
│
├── Dockerfile                            # Multi-stage production container build
├── docker-compose.yml                    # Development Docker Compose (PostgreSQL, Redis)
├── docker-compose.prod.yml               # Production Docker Stack (Postgres, Redis, Backend)
├── package.json                          # Node.js Dependencies & NPM Scripts
├── package-lock.json                     # Pinned Dependency Lockfile
├── tsconfig.json                         # TypeScript Configuration
├── TASK_BREAKDOWN_BE_SECURITY.md         # Master Task Breakdown & Execution Baseline
└── .gitignore                            # Git Exclusion Rules
```

---

## 4. Getting Started (Development Mode)

### Prerequisites:
- Node.js >= 22.0.0
- Docker & Docker Compose
- PostgreSQL 16 with PostGIS 3.4
- Redis 7

### Quick Start:
```bash
# 1. Start Infrastructure Containers (PostgreSQL + PostGIS & Redis)
docker compose up -d postgres redis

# 2. Run Database Migrations & Generate Prisma Client
npx prisma migrate deploy
npx prisma generate

# 3. Start Backend Development Server with Hot-Reload
npm run start:dev
```
The API will be accessible at `http://localhost:3000/v1` and WebSocket at `ws://localhost:3000/v1/realtime`.

---

## 5. Verification & Testing

Execute the comprehensive test suites directly from the project root:

```bash
# Run Unit Tests (9 test suites, 73 tests)
npm run test

# Run End-to-End Integration Tests (42 test suites, 154 tests)
npm run test:e2e

# Run Clean Production Build
npm run build
```

To execute the live 59-route REST smoke test against a running instance:
```bash
bash scripts/api-smoke-test.sh
```

---

## 6. Living Contracts & Handoff Reference

- **REST API Master Reference:** [`docs/distribution-system-docs/API-ENDPOINTS.md`](docs/distribution-system-docs/API-ENDPOINTS.md)
- **Frontend Handoff Guide:** [`docs/distribution-system-docs/HANDOFF-FE.md`](docs/distribution-system-docs/HANDOFF-FE.md)
- **Infrastructure Handoff Guide:** [`docs/distribution-system-docs/HANDOFF-INFRA-DEVOPS.md`](docs/distribution-system-docs/HANDOFF-INFRA-DEVOPS.md)
- **OpenAPI Specification:** [`docs/distribution-system-docs/openapi/openapi.yaml`](docs/distribution-system-docs/openapi/openapi.yaml)
- **WebSocket Realtime Contract:** [`docs/distribution-system-docs/06-API-REALTIME.md`](docs/distribution-system-docs/06-API-REALTIME.md)
