# Health & Observability API Contract

**Document Status:** LIVING CONTRACT — Updated Incrementally from Phase 8
**Phase:** 8 — System Integration, Notifications, Observability & Deployment
**Date:** 2026-09-02
**Version:** 1.0.0

---

## GET /v1/health/liveness

### Purpose
Liveness probe for container orchestrators (Kubernetes / Docker) and host monitors.
Verifies that the NestJS process is running and responsive.

### Authentication & Authorization
- **Public** — No authentication required

### Response — `200 OK`
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "uptime": 124.52,
    "timestamp": "2026-09-02T10:20:00.000Z"
  },
  "timestamp": "2026-09-02T10:20:00.000Z",
  "requestId": "req-uuid-1234"
}
```

---

## GET /v1/health/readiness

### Purpose
Readiness probe for load balancers and deployment verification.
Deep check evaluating database connectivity, Redis cache availability, private storage directory access, and memory heap thresholds.

### Authentication & Authorization
- **Public** — No authentication required

### Response — `200 OK` (Healthy)
```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "storage": { "status": "up", "path": "/app/storage/private/pod" },
    "memory_heap": { "status": "up" }
  },
  "error": {},
  "details": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "storage": { "status": "up", "path": "/app/storage/private/pod" },
    "memory_heap": { "status": "up" }
  }
}
```

### Response — `503 Service Unavailable` (Unhealthy)
Returned if database, Redis, or storage health check fails.
```json
{
  "status": "error",
  "error": {
    "database": { "status": "down", "message": "Connection timeout" }
  }
}
```
