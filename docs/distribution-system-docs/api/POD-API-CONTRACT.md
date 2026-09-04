# Proof of Delivery (POD) & Secure File Upload API Contract

**Document Status:** LIVING CONTRACT — Updated Incrementally from Phase 6
**Phase:** 6 — Delivery Lifecycle, POD & Conflicts
**Date:** 2026-09-02
**Version:** 1.0.0

---

## POST /v1/files/upload

### Purpose
Upload a POD photo or signature file to private storage.

### Validation Rules
- Magic Bytes Check: JPEG, PNG, WebP only.
- Size limit: Photo $\le 5\text{ MB}$, Signature $\le 500\text{ KB}$.

### Response — `201 Created`
```json
{
  "success": true,
  "data": {
    "fileId": "file-uuid-12345",
    "objectKey": "pod/2026/09/uuid.jpg",
    "mediaType": "image/jpeg",
    "sizeBytes": 1024500
  }
}
```

---

## GET /v1/files/:id/download

### Purpose
Retrieve/download a private file. Strictly guarded by JWT and ownership check. No public URLs exist.

---

## POST /v1/me/stops/:id/pod

### Purpose
Submit Proof of Delivery (POD) metadata for a stop, marking stop status as `DELIVERED`.

### Request Body Schema
```json
{
  "receiverName": "Budi Santoso",
  "photoFileId": "file-uuid-12345",
  "signatureFileId": "file-uuid-sig678",
  "notes": "Barang diterima dalam kondisi baik",
  "idempotencyKey": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

### Response — `201 Created`
```json
{
  "success": true,
  "data": {
    "podId": "pod-uuid-1",
    "deliveryStopId": "stop-uuid-1",
    "status": "DELIVERED",
    "completedAt": "2026-09-02T10:20:00.000Z"
  }
}
```
