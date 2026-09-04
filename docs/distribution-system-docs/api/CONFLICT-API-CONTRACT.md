# Offline Outbox Sync & Conflict API Contract

**Document Status:** LIVING CONTRACT — Updated Incrementally from Phase 6
**Phase:** 6 — Delivery Lifecycle, POD & Conflicts
**Date:** 2026-09-02
**Version:** 1.0.0

---

## POST /v1/me/sync/outbox

### Purpose
Ingest a batch of offline outbox events collected while mobile driver was disconnected (max 50 events).

### Request Body Schema
```json
{
  "events": [
    {
      "clientEventId": "client-evt-001",
      "idempotencyKey": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "eventType": "stop.delivered",
      "occurredAt": "2026-09-02T09:00:00.000Z",
      "payload": {
        "deliveryStopId": "stop-uuid-1",
        "receiverName": "Budi Santoso",
        "photoFileId": "file-uuid-1"
      }
    }
  ]
}
```

### Response — `201 Created`
```json
{
  "success": true,
  "data": {
    "acked": ["client-evt-001"],
    "conflicts": []
  }
}
```

---

## GET /v1/conflicts

### Purpose
Retrieve list of open delivery conflicts for Owner/Admin review.

### Authorization
- `ADMIN`, `SUPER_ADMIN`, `OWNER` only.

---

## POST /v1/conflicts/:id/resolve

### Purpose
Resolve an open delivery conflict with evidence-preserving resolution.

### Request Body Schema
```json
{
  "status": "RESOLVED_OVERRIDDEN",
  "resolutionNotes": "POD photo verified manually by Owner"
}
```
