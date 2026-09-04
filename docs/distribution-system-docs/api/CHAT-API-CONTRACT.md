# E2E Encrypted Chat API Contract

**Document Status:** LIVING CONTRACT — Updated Incrementally from Phase 7
**Phase:** 7 — Communication, E2EE Chat & WebRTC
**Date:** 2026-09-02
**Version:** 1.0.0

---

## POST /v1/conversations

### Purpose
Creates or retrieves a 1:1 direct conversation between an Owner/Admin and a Driver.

### Authentication & Authorization
- **Allowed Roles:** `ADMIN`, `SUPER_ADMIN`, `OWNER`
- **Recipient:** Must be a valid `driverId`

### Request Body Schema
```json
{
  "driverId": "drv-uuid-1"
}
```

### Response — `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "conv-uuid-1",
    "type": "DIRECT_1TO1",
    "ownerId": "owner-user-uuid",
    "driverId": "drv-uuid-1",
    "status": "ACTIVE",
    "createdAt": "2026-09-02T10:00:00.000Z"
  }
}
```

---

## GET /v1/conversations

### Purpose
Lists all active 1:1 conversations for the authenticated user (Owner or Driver).

---

## GET /v1/conversations/:id/messages

### Purpose
Retrieves paginated historical ciphertext messages for a conversation.
Zero plaintext is stored or returned by the server.

### Query Parameters
- `limit`: default 50, max 100
- `offset`: default 0

### Response — `200 OK`
```json
{
  "success": true,
  "data": {
    "conversationId": "conv-uuid-1",
    "messages": [
      {
        "id": "msg-uuid-1",
        "senderUserId": "owner-uuid",
        "senderDeviceId": "device-uuid-1",
        "recipientDeviceId": "device-uuid-2",
        "protocolVersion": 1,
        "ciphertextBlob": "Base64EncryptedCiphertextBlobString==",
        "headerJson": { "dhPublicKey": "Base64Key" },
        "createdAt": "2026-09-02T10:00:00.000Z",
        "deliveredAt": "2026-09-02T10:00:01.000Z",
        "readAt": null
      }
    ],
    "pagination": { "limit": 50, "offset": 0, "total": 1 }
  }
}
```

---

## POST /v1/conversations/:id/messages

### Purpose
Send an E2EE encrypted ciphertext message (REST Fallback).

### Rate Limit
- 10 messages / second per user (`throttle:chat:send:<userId>`)

### Request Body Schema
```json
{
  "recipientDeviceId": "device-uuid-2",
  "protocolVersion": 1,
  "ciphertextBlob": "Base64EncryptedCiphertextBlobString==",
  "headerJson": { "dhPublicKey": "Base64Key" },
  "idempotencyKey": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```
