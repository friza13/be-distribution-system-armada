# Phase 7: Communication, E2EE Chat & WebRTC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun subsistem komunikasi realtime yang aman mencakup 1:1 E2EE Text Messaging, Voice PTT Signaling, Video Call Signaling berbasis WebRTC, dan ephemeral TURN credentials tanpa meregresikan Phase 0–6.

**Architecture:** NestJS `ConversationsModule`, `CommunicationModule`, `ConversationsService`, `MessagesService`, `TurnCredentialService`, `CallSessionService`, `RealtimeGateway`, Prisma Client.

---

## File Structure Map

```text
backend/
├── src/
│   └── modules/
│       ├── conversations/
│       │   ├── dto/
│       │   │   ├── create-conversation.dto.ts
│       │   │   ├── send-message.dto.ts
│       │   │   ├── get-messages-query.dto.ts
│       │   │   └── chat-send-ws.dto.ts
│       │   ├── conversations.service.ts
│       │   ├── messages.service.ts
│       │   ├── conversations.controller.ts
│       │   └── conversations.module.ts
│       └── communication/
│           ├── dto/
│           │   ├── initiate-call.dto.ts
│           │   ├── call-response.dto.ts
│           │   └── webrtc-signal-ws.dto.ts
│           ├── services/
│           │   ├── turn-credential.service.ts
│           │   └── call-session.service.ts
│           ├── communication.controller.ts
│           └── communication.module.ts
└── test/
    └── communication/
        ├── conversation-e2ee.e2e-spec.ts
        ├── ws-chat-streaming.e2e-spec.ts
        ├── webrtc-session.e2e-spec.ts
        ├── ws-webrtc-signaling.e2e-spec.ts
        └── comm-security.e2e-spec.ts
```

---

## Tasks & Steps

- [x] **Task 7.1 (`COMM-001`): E2EE Conversation & Message Ingestion Service**
  - Implement `ConversationsService` & `MessagesService` (1:1 conversations, ciphertext persistence, zero plaintext logging, IDOR defense).
  - Test: `test/communication/conversation-e2ee.e2e-spec.ts`.

- [x] **Task 7.2 (`COMM-002`): Realtime Chat Streaming & ACK Protocol**
  - Implement WebSocket `@SubscribeMessage('chat.message.send')` & `chat.message.ack`.
  - Test: `test/communication/ws-chat-streaming.e2e-spec.ts`.

- [x] **Task 7.3 (`COMM-003`): WebRTC Call Session State Machine & Ephemeral TURN Credentials**
  - Implement `CallSessionService` & `TurnCredentialService` (RFC 7635 HMAC-SHA1 credentials, PENDING $\rightarrow$ ACTIVE $\rightarrow$ ENDED / DECLINED / TIMEOUT).
  - Test: `test/communication/webrtc-session.e2e-spec.ts`.

- [x] **Task 7.4 (`COMM-004`): WebRTC Realtime Signaling Gateway**
  - Implement WebSocket signaling handlers (`webrtc.signal.offer`, `answer`, `ice_candidate`, `ended`).
  - Test: `test/communication/ws-webrtc-signaling.e2e-spec.ts`.

- [x] **Task 7.5 (`COMM-005`): Abuse Protection, Rate Limiting & API Contract Finalization**
  - Implement rate limiters (10 msgs/sec & 3 call invites/min), zero-secret audit logging.
  - Test: `test/communication/comm-security.e2e-spec.ts`.
