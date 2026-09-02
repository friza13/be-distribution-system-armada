# WebRTC Call Session & Signaling API Contract

**Document Status:** LIVING CONTRACT — Updated Incrementally from Phase 7
**Phase:** 7 — Communication, E2EE Chat & WebRTC
**Date:** 2026-09-02
**Version:** 1.0.0

---

## POST /v1/voice-sessions

### Purpose
Owner/Admin initiates a 1:1 Voice PTT session to a Driver. Generates time-based ephemeral TURN credentials (RFC 7635).

### Rate Limit
- 3 call invites / minute per user (`throttle:call:invite:<userId>`)

### Request Body Schema
```json
{
  "driverId": "drv-uuid-1",
  "type": "VOICE_PTT",
  "deliveryId": "del-uuid-1"
}
```

### Response — `201 Created`
```json
{
  "success": true,
  "data": {
    "sessionId": "session-uuid-1",
    "type": "VOICE_PTT",
    "ownerId": "owner-uuid",
    "driverId": "drv-uuid-1",
    "status": "PENDING",
    "turnCredentials": {
      "urls": ["turn:turn.domain.com:3478?transport=udp"],
      "username": "1788352800:owner-uuid",
      "credential": "HMAC_SHA1_Base64_String",
      "ttlSeconds": 3600
    }
  }
}
```

---

## POST /v1/video-sessions

### Purpose
Owner/Admin initiates a 1:1 Video Call request to a Driver. Driver explicit acceptance required before signaling.

---

## POST /v1/realtime/sessions/:id/respond

### Purpose
Driver responds to incoming call request (`ACCEPT` or `DECLINE`).

### Request Body Schema
```json
{
  "action": "ACCEPT"
}
```

### Response — `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "session-uuid-1",
    "status": "ACTIVE",
    "startedAt": "2026-09-02T10:00:00.000Z"
  }
}
```

---

## POST /v1/realtime/sessions/:id/end

### Purpose
Ends active call session. Status transitions to `ENDED`.
