# Fleet Monitoring & Location History API Contract

**Document Status:** LIVING CONTRACT — Updated Incrementally from Phase 4
**Phase:** 4 — Telemetry, GPS Streaming & Fleet
**Date:** 2026-09-02
**Version:** 2.0.0 (Corrective Reconciled)

> This document is the canonical API contract for fleet live tracking and driver location history endpoints.

---

## GET /v1/fleet/locations

### Purpose
Retrieve the real-time latest GPS location for all active drivers. Used by the Owner Mobile application (Fleet Map) and Admin Web dashboard.

### Authentication
- **Required:** Yes
- **Mechanism:** `Authorization: Bearer <JWT_ACCESS_TOKEN>` or In-Memory Admin Web token

### Authorization & Anti-IDOR Defense
- **Allowed Roles:** `ADMIN`, `SUPER_ADMIN`, `OWNER`
- **Rejected Roles:** `DRIVER` → `403 FORBIDDEN` (`FLEET_ACCESS_DENIED`)
- **Scope Rule:**
  - Owner sees all drivers within their company/operational scope.
  - Driver role is strictly denied from reading fleet-wide locations.

### Data Source
Fast lookup from Redis cache key `driver:location:latest:*`.
Fallback to PostgreSQL `location_points` if cache miss occurs.

### Request

**Method:** `GET`
**Path:** `/v1/fleet/locations`

**Query Parameters:** None

### Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "drivers": [
      {
        "driverId": "b8a34f89-8d7e-4a61-9c60-84a92c304d91",
        "driverName": "Budi Santoso",
        "employeeCode": "EMP-001",
        "operationalStatus": "ON_DELIVERY",
        "activeVehicleId": "veh-12345",
        "plateNumber": "B 1234 CD",
        "currentDeliveryId": "c8f5f0b4-3a7e-46d2-850f-2b1b51e0cf9b",
        "location": {
          "latitude": -6.20012,
          "longitude": 106.81620,
          "accuracyM": 8.4,
          "speedMps": 11.7,
          "headingDeg": 87.0,
          "recordedAt": "2026-09-02T10:20:00.000Z",
          "receivedAt": "2026-09-02T10:20:00.045Z"
        }
      }
    ],
    "count": 1
  },
  "timestamp": "2026-09-02T10:20:00.050Z",
  "requestId": "req-uuid-here"
}
```

### Error Responses

| HTTP | Error Code | Condition |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid JWT |
| `401` | `SESSION_REVOKED` | JWT session has been revoked |
| `403` | `INSUFFICIENT_ROLE` | Role is `DRIVER` (Denied by RolesGuard) |

---

## GET /v1/drivers/:id/location-history

### Purpose
Retrieve historical GPS breadcrumb trails for a specific driver within a requested time window.
Used for trip history review, dispute resolution, and operational audit.

### Authentication & Authorization (Unified Reconciled Policy)
- **Allowed Roles:** `ADMIN`, `SUPER_ADMIN`, `OWNER`, `DRIVER` (own history ONLY)
- **Unified Anti-IDOR Defense:**
  - **DRIVER:** Target `:id` MUST equal `req.user.driverId`. Cross-driver query (`:id !== req.user.driverId`) returns `403 FORBIDDEN (RESOURCE_FORBIDDEN)`.
  - **OWNER:** Target `:id` must belong to driver in owner's company scope.
  - **ADMIN / SUPER_ADMIN:** Full access to all drivers.

### Request

**Method:** `GET`
**Path:** `/v1/drivers/:id/location-history`

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|:---:|---|---|
| `from` | `string` (ISO-8601) | ✅ | — | Start timestamp of range |
| `to` | `string` (ISO-8601) | ❌ | `NOW()` | End timestamp of range |
| `limit` | `number` | ❌ | `100` | Pagination limit (max 500) |
| `offset` | `number` | ❌ | `0` | Pagination offset |

**Example Request:**
`GET /v1/drivers/b8a34f89-8d7e-4a61-9c60-84a92c304d91/location-history?from=2026-09-02T08:00:00Z&to=2026-09-02T12:00:00Z&limit=50`

### Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "driverId": "b8a34f89-8d7e-4a61-9c60-84a92c304d91",
    "points": [
      {
        "id": "loc-uuid-1",
        "deliveryId": "c8f5f0b4-3a7e-46d2-850f-2b1b51e0cf9b",
        "latitude": -6.20012,
        "longitude": 106.81620,
        "accuracyM": 8.4,
        "speedMps": 11.7,
        "headingDeg": 87.0,
        "recordedAt": "2026-09-02T08:00:00.000Z",
        "receivedAt": "2026-09-02T08:00:00.045Z",
        "validationStatus": "VALID"
      }
    ],
    "pagination": {
      "limit": 50,
      "offset": 0,
      "total": 1
    }
  },
  "timestamp": "2026-09-02T10:20:00.050Z",
  "requestId": "req-uuid-here"
}
```

### Error Responses

| HTTP | Error Code | Condition |
|---|---|---|
| `400` | `INVALID_DATE_RANGE` | `from` > `to` or invalid date string |
| `401` | `UNAUTHORIZED` | Missing or invalid JWT |
| `403` | `RESOURCE_FORBIDDEN` | Driver attempting to read another driver's history (`:id !== req.user.driverId`) |
| `404` | `DRIVER_NOT_FOUND` | `:id` does not exist |
