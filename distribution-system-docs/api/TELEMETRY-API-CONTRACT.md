# Telemetry API Contract — GPS Ingestion Endpoints

**Document Status:** LIVING CONTRACT — Updated Incrementally from Phase 4
**Phase:** 4 — Telemetry, GPS Streaming & Fleet
**Date:** 2026-09-02
**Version:** 2.0.0 (Corrective Reconciled)

> This document is the canonical API contract for all GPS telemetry ingestion endpoints.
> Any change to implementation MUST be reflected here simultaneously.

---

## General Conventions

- Base URL: `/v1`
- Authentication: `Authorization: Bearer <JWT_ACCESS_TOKEN>` (Mobile) or In-Memory access token (Admin Web)
- All timestamps: ISO-8601 UTC (`2026-09-02T10:20:00.000Z`)
- All errors follow standard envelope: `{ success: false, error: { code, message, requestId } }`

---

## POST /v1/me/location

### Purpose
Submit a single GPS telemetry data point from a Driver's smartphone.
This is the primary ingestion endpoint used during an active delivery.

### Authentication
- **Required:** Yes
- **Mechanism:** `Authorization: Bearer <JWT_ACCESS_TOKEN>`
- **Session:** Valid, non-revoked session required

### Authorization & Scope Enforcement
- **Allowed Roles:** `DRIVER` only
- **Rejected Roles:** `OWNER`, `ADMIN`, `SUPER_ADMIN` → `403 FORBIDDEN`
- **driverId Source:** Always derived from JWT context (`req.user.driverId`). Never trusted from request body.
- **Delivery Ownership Enforcement:** If `deliveryId` is provided in body, backend asserts `delivery.driverId === req.user.driverId`. If unassigned or assigned to another driver, request is rejected with `403 FORBIDDEN (DELIVERY_NOT_ASSIGNED_TO_DRIVER)`.

### Rate Limiting
- **Limit:** 1 request per second per driver
- **Key:** `throttle:location:driver:<driverId>`
- **On Exceed:** `429 Too Many Requests` (`Retry-After: 1`)

### Idempotency Behavior
- **Race-Safe Key:** `idempotencyKey` (UUID) checked against DB `idempotency_records` table with `@@unique([key, userId, endpoint])`.
- **Concurrent Retries:** If duplicate `idempotencyKey` is sent concurrently, database unique constraint `P2002` catches it and returns the original cached response with `200 OK`.

### Request

**Method:** `POST`
**Path:** `/v1/me/location`
**Content-Type:** `application/json`

**Request Body Schema:**

| Field | Type | Required | Description |
|---|---|:---:|---|
| `latitude` | `number` | ✅ | Latitude in decimal degrees. Range: -90.0 to 90.0 |
| `longitude` | `number` | ✅ | Longitude in decimal degrees. Range: -180.0 to 180.0 |
| `accuracyM` | `number` | ✅ | GPS accuracy in meters. Must be > 0. Rejected if > 50m |
| `recordedAt` | `string` (ISO-8601) | ✅ | Timestamp when GPS was recorded on device |
| `speedMps` | `number` | ❌ | Speed in meters/second (if available from GPS platform) |
| `headingDeg` | `number` | ❌ | Heading in degrees (0–360, if available) |
| `deliveryId` | `string` (UUID) | ❌ | Active delivery ID (must be assigned to authenticated driver) |
| `idempotencyKey` | `string` (UUID) | ❌ | Idempotency key to prevent duplicate processing |

### Response

**Success Response — `201 Created`:**
```json
{
  "success": true,
  "data": {
    "locationId": "a3f9c2d1-8b7e-4a61-9c60-84a92c304d91",
    "validationStatus": "VALID",
    "receivedAt": "2026-09-02T10:20:00.045Z"
  },
  "timestamp": "2026-09-02T10:20:00.045Z",
  "requestId": "req-uuid-here"
}
```

**Idempotent Response (already processed) — `200 OK`:**
```json
{
  "success": true,
  "data": {
    "locationId": "a3f9c2d1-8b7e-4a61-9c60-84a92c304d91",
    "validationStatus": "VALID",
    "receivedAt": "2026-09-02T10:19:55.000Z",
    "idempotent": true
  }
}
```

---

## POST /v1/me/location/batch

### Purpose
Submit a batch of GPS data points collected while offline (max 50 points). Used for offline outbox sync when driver reconnects to network.

### Rate Limiting
- **Limit:** 1 batch per 60 seconds per driver
- **Key:** `throttle:location:batch:driver:<driverId>`
- **On Exceed:** `429 Too Many Requests` (`Retry-After: 60`)

### Idempotency Behavior
- **Batch-Level Idempotency:** Optional `idempotencyKey` in batch body wraps the whole batch execution. If retried, returns cached batch response.

### Request Body Schema
```json
{
  "idempotencyKey": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "points": [
    {
      "latitude": -6.20012,
      "longitude": 106.81620,
      "accuracyM": 8.4,
      "speedMps": 11.7,
      "headingDeg": 87.0,
      "recordedAt": "2026-09-02T09:00:00.000Z",
      "deliveryId": "c8f5f0b4-3a7e-46d2-850f-2b1b51e0cf9b"
    }
  ]
}
```

### Response — `201 Created`

```json
{
  "success": true,
  "data": {
    "accepted": 2,
    "rejected": 0,
    "errors": [],
    "latestBroadcast": {
      "latitude": -6.20100,
      "longitude": 106.81700,
      "recordedAt": "2026-09-02T09:01:00.000Z"
    }
  },
  "timestamp": "2026-09-02T10:20:00.000Z",
  "requestId": "req-uuid-here"
}
```
