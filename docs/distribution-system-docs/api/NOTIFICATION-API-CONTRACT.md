# Operational Notifications & Push Token API Contract

**Document Status:** LIVING CONTRACT — Updated Incrementally from Phase 8
**Phase:** 8 — System Integration, Notifications, Observability & Deployment
**Date:** 2026-09-02
**Version:** 1.0.0

---

## POST /v1/devices/register-push-token

### Purpose
Registers or updates the FCM/APNs push notification token for an authenticated device.

### Authentication & Authorization
- **Allowed Roles:** `ADMIN`, `SUPER_ADMIN`, `OWNER`, `DRIVER`
- **Ownership:** `device.userId === req.user.id`

### Request Body Schema
```json
{
  "deviceId": "device-uuid-1",
  "pushToken": "fcm_token_sample_string_12345"
}
```

### Response — `200 OK`
```json
{
  "success": true,
  "data": {
    "deviceId": "device-uuid-1",
    "pushTokenRegistered": true
  }
}
```

---

## GET /v1/notifications

### Purpose
Retrieves paginated operational notifications for the authenticated user.

### Query Parameters
- `limit`: default 20, max 100
- `offset`: default 0

### Response — `200 OK`
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "notif-uuid-1",
        "type": "DELIVERY_ASSIGNED",
        "title": "Pengiriman Baru",
        "body": "Tugas pengiriman baru telah ditugaskan kepada Anda",
        "payloadJson": { "deliveryId": "del-123" },
        "status": "SENT",
        "createdAt": "2026-09-02T10:20:00.000Z"
      }
    ],
    "pagination": { "limit": 20, "offset": 0, "total": 1 }
  }
}
```

---

## PATCH /v1/notifications/:id/read

### Purpose
Marks an operational notification as read.
