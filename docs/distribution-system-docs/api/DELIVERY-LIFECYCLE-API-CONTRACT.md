# Delivery Lifecycle API Contract

**Document Status:** LIVING CONTRACT — Updated Incrementally from Phase 6
**Phase:** 6 — Delivery Lifecycle, POD & Conflicts
**Date:** 2026-09-02
**Version:** 1.0.0

---

## POST /v1/deliveries

### Purpose
Create a new delivery order with items and destination stops in `DRAFT` status.

### Authentication & Authorization
- **Allowed Roles:** `ADMIN`, `SUPER_ADMIN`, `OWNER`

### Request Body Schema
```json
{
  "deliveryCode": "DEL-20260902-001",
  "plannedStartAt": "2026-09-02T10:00:00.000Z",
  "items": [
    { "itemCode": "ITEM-01", "itemName": "Box A", "quantity": 10, "unit": "BOX", "weightKg": 5.5 }
  ],
  "stops": [
    { "sequence": 1, "destinationName": "Gudang Monas", "address": "Jakarta Pusat", "latitude": -6.1754, "longitude": 106.8272 }
  ]
}
```

### Response — `201 Created`
```json
{
  "success": true,
  "data": {
    "deliveryId": "del-uuid-1",
    "deliveryCode": "DEL-20260902-001",
    "status": "DRAFT",
    "createdAt": "2026-09-02T10:00:00.000Z"
  }
}
```

---

## POST /v1/deliveries/:id/assign

### Purpose
Assign a Driver and Vehicle to a delivery, moving status from `DRAFT` to `ASSIGNED`.

### Request Body Schema
```json
{
  "driverId": "drv-uuid-1",
  "vehicleId": "veh-uuid-1"
}
```

---

## POST /v1/deliveries/:id/accept

### Purpose
Driver accepts delivery assignment, moving status from `ASSIGNED` to `ACCEPTED`.

---

## POST /v1/deliveries/:id/start

### Purpose
Driver starts the delivery trip, moving status from `ACCEPTED` to `EN_ROUTE` (`startedAt = NOW()`).

---

## POST /v1/deliveries/:id/complete

### Purpose
Explicitly triggers completion evaluation. Status transitions to `COMPLETED` if all stops are terminal (`DELIVERED`, `FAILED`, `SKIPPED`) and $\ge 1$ stop is `DELIVERED`.

---

## POST /v1/me/stops/:id/arrive

### Purpose
Driver arrives at a stop destination (`EN_ROUTE` $\rightarrow$ `ARRIVED`, `arrivedAt = NOW()`).
