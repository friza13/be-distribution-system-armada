# Route Optimization & Management API Contract

**Document Status:** LIVING CONTRACT — Updated Incrementally from Phase 5
**Phase:** 5 — Route Optimization, Routing Provider & 2-Opt
**Date:** 2026-09-02
**Version:** 1.0.0

---

## General Conventions

- Base URL: `/v1`
- Authentication: `Authorization: Bearer <JWT_ACCESS_TOKEN>`
- All timestamps: ISO-8601 UTC (`2026-09-02T10:20:00.000Z`)

---

## POST /v1/deliveries/:id/routes/recommend

### Purpose
Calculates and returns a recommended optimal stop sequence for a delivery without modifying the active database route.
Uses $N \le 5$ Exhaustive Permutation Search or $N > 5$ Nearest-Neighbor + 2-Opt.

### Authentication & Authorization
- **Allowed Roles:** `ADMIN`, `SUPER_ADMIN`, `OWNER`, `DRIVER` (assigned driver only)
- **Anti-IDOR:** Driver must be assigned to delivery (`delivery.driverId === req.user.driverId`).

### Request
**Method:** `POST`
**Path:** `/v1/deliveries/:id/routes/recommend`

**Query Parameters:**
- `provider` (optional): `osrm` | `haversine` (default: auto fallback)

### Response — `200 OK`
```json
{
  "success": true,
  "data": {
    "deliveryId": "del-c8f5-f0b4",
    "algorithm": "EXHAUSTIVE_PERMUTATION",
    "providerUsed": "OSRM",
    "totalDistanceMeters": 14250.5,
    "estimatedDurationSeconds": 1450,
    "recommendedSequence": [
      { "sequence": 1, "deliveryStopId": "stop-uuid-1", "destinationName": "Gudang A" },
      { "sequence": 2, "deliveryStopId": "stop-uuid-2", "destinationName": "Toko B" }
    ],
    "polylineGeojson": { "type": "LineString", "coordinates": [[106.8162, -6.20012], [106.8200, -6.20500]] }
  },
  "timestamp": "2026-09-02T10:20:00.000Z",
  "requestId": "req-uuid"
}
```

---

## POST /v1/deliveries/:id/routes/select

### Purpose
Selects and activates a recommended or calculated route for a delivery, creating an immutable new version (`version = max + 1`).

### Request Body
```json
{
  "source": "RECOMMENDED_2OPT",
  "recommendedSequence": ["stop-uuid-1", "stop-uuid-2"],
  "totalDistanceMeters": 14250.5,
  "estimatedDurationSeconds": 1450,
  "idempotencyKey": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

### Response — `201 Created`
```json
{
  "success": true,
  "data": {
    "routeId": "route-uuid-v2",
    "deliveryId": "del-c8f5-f0b4",
    "version": 2,
    "source": "RECOMMENDED_2OPT",
    "selectedAt": "2026-09-02T10:20:00.000Z"
  }
}
```

---

## PATCH /v1/deliveries/:id/routes/reorder

### Purpose
Manually reorders the sequence of stops for a delivery (`RouteMode.MANUAL`), creating a new route version.

### Request Body
```json
{
  "stopSequence": [
    { "deliveryStopId": "stop-uuid-2", "sequence": 1 },
    { "deliveryStopId": "stop-uuid-1", "sequence": 2 }
  ]
}
```

### Response — `200 OK`
```json
{
  "success": true,
  "data": {
    "routeId": "route-uuid-v3",
    "version": 3,
    "source": "MANUAL",
    "updatedAt": "2026-09-02T10:21:00.000Z"
  }
}
```

---

## GET /v1/deliveries/:id/routes/current

### Purpose
Retrieves the active (latest version) route for a delivery.

### Response — `200 OK`
```json
{
  "success": true,
  "data": {
    "routeId": "route-uuid-v3",
    "version": 3,
    "source": "MANUAL",
    "totalDistanceMeters": 15000.0,
    "estimatedDurationSeconds": 1550,
    "stops": [
      { "sequence": 1, "deliveryStopId": "stop-uuid-2", "destinationName": "Toko B" },
      { "sequence": 2, "deliveryStopId": "stop-uuid-1", "destinationName": "Gudang A" }
    ]
  }
}
```

---

## GET /v1/deliveries/:id/routes/versions

### Purpose
Retrieves all historical route versions for audit and tracking.

### Response — `200 OK`
```json
{
  "success": true,
  "data": {
    "versions": [
      { "version": 3, "source": "MANUAL", "selectedAt": "2026-09-02T10:21:00.000Z" },
      { "version": 2, "source": "RECOMMENDED_2OPT", "selectedAt": "2026-09-02T10:20:00.000Z" },
      { "version": 1, "source": "RECOMMENDED_2OPT", "selectedAt": "2026-09-02T09:00:00.000Z" }
    ]
  }
}
```
