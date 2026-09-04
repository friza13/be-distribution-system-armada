# Approved Findings Implementation Report

## Summary

Implemented the seven approved security and logic findings with surgical changes on `review/logic-code-fixes`. No Prisma schema or generated artifact was edited. Public registration no longer accepts client-controlled roles; revocation, refresh rotation, WebRTC authorization, delivery state, route completeness, and existing owner boundaries are hardened.

## Findings addressed

- **SEC-001 — Public registration privilege escalation:** Removed `roleCode` from `RegisterUserDto`. `AuthService.registerUser` always assigns the server-selected `DRIVER` role and creates `PENDING_ACTIVATION` accounts. Privileged roles cannot be created through the unauthenticated endpoint.
- **SEC-002 — Owner/company/object scope:** Added owner checks using the strongest existing immutable boundary (`Delivery.createdBy`) to delivery reads/assignment, route access, delivery WebSocket rooms, POD file downloads, and delivery-linked call initiation. The existing driver assignment checks remain. A tenant/company relation is not present in the schema, so fleet monitoring remains role-gated rather than falsely claiming company isolation; the full tenant requirement remains unimplemented and is listed below.
- **SEC-003 — WebRTC participant/signaling authorization:** Call response and hangup now require the owner/driver participant (or explicit admin override). Signaling requires an authorized participant, an active non-expired session, and membership in the Socket.IO session room. Delivery-linked owner call initiation is also scoped. Existing DTO/payload replay nonce and sequence metadata were not introduced to avoid an unreviewed protocol contract change.
- **SEC-004 — Redis revocation fail-open:** `RedisService.isRevoked` now returns an unavailable sentinel (`null`) instead of `false`. JWT REST and WebSocket authentication perform authoritative session/device database checks when Redis is unavailable, rejecting revoked, expired, mismatched, or inactive credentials.
- **SEC-005 — Atomic refresh rotation:** Refresh rotation now runs in one Prisma transaction and claims the old session with a conditional `updateMany` (`id` plus `isRevoked = false`). A losing concurrent request cannot create a successor and triggers token-family compromise/revocation handling.
- **LOGIC-001 — Terminal delivery child mutations:** Stop writes use terminal-parent guards and conditional updates. POD submission rejects terminal parent deliveries before processing and claims the stop only while the parent remains operational inside the transaction.
- **LOGIC-002 — Complete route stop sets:** Route selection and manual reorder now require every delivery stop exactly once; reorder sequences must be unique and contiguous `1..N`. Empty route selections are rejected at DTO and service boundaries.

## Files changed

- `backend/src/common/redis/redis.service.ts`
- `backend/src/modules/auth/auth.service.ts`
- `backend/src/modules/auth/dto/register-user.dto.ts`
- `backend/src/modules/auth/strategies/jwt.strategy.ts`
- `backend/src/modules/communication/services/call-session.service.ts`
- `backend/src/modules/deliveries/services/deliveries.service.ts`
- `backend/src/modules/deliveries/services/delivery-stops.service.ts`
- `backend/src/modules/fleet/fleet.service.ts` (reviewed; no final behavior change)
- `backend/src/modules/pod/services/file-storage.service.ts`
- `backend/src/modules/pod/services/pod.service.ts`
- `backend/src/modules/realtime/gateways/realtime.gateway.ts`
- `backend/src/modules/realtime/guards/ws-jwt-auth.guard.ts`
- `backend/src/modules/realtime/services/ws-room-authorizer.service.ts`
- `backend/src/modules/routes/dto/select-route.dto.ts`
- `backend/src/modules/routes/services/routes-domain.service.ts`
- `backend/src/modules/sessions/session.service.ts`
- `backend/test/security/logic-code-fixes.spec.ts`

Key implementation references include registration at `auth.service.ts:321-360`, refresh CAS at `session.service.ts:124-227`, participant/signaling checks at `call-session.service.ts:141-290` and `realtime.gateway.ts:556-646`, terminal stop guards at `delivery-stops.service.ts:100-252`, and route set validation at `routes-domain.service.ts:170-474`.

## Tests and commands

- `./node_modules/.bin/jest --config ./test/jest-unit.json test/security/logic-code-fixes.spec.ts --runInBand` — **9 passed**.
- `npm test -- --runInBand` — **8 suites, 54 tests passed**.
- `npm run build` — **passed**.
- `npm run test:e2e -- --runInBand` — **42 suites, 154 tests passed**.
- `./node_modules/.bin/eslint <changed files>` — not run successfully because `backend/node_modules/.bin/eslint` is absent; the existing `npm run lint` script references a dependency that is not installed.

The e2e suite reported expected test-console output for invalid JSON/rejected oversized requests and Jest noted existing asynchronous handles after completion; all suites and assertions passed.

## Concerns and follow-up limits

1. The Prisma schema has no company/tenant relation. Owner isolation is therefore enforced where `createdBy` or direct participant/assignment ownership exists. Fleet monitoring still exposes active fleet data to authorized owners because no safe company key exists for that resource; implementing complete tenant isolation requires a schema/backfill/migration and query-wide propagation.
2. Public registration now creates pending `DRIVER` accounts, but a secure activation/bootstrap workflow is outside this change and remains to be implemented and verified.
3. WebRTC signaling now enforces participant, active-session, expiry, and room membership. Explicit nonce/sequence replay protection was not added because it requires a coordinated client/server protocol change.
4. Redis writes remain best-effort for revocation propagation; REST and WebSocket credential validation remain safe during Redis outage through database session checks, while instant cross-node socket teardown still depends on Redis Pub/Sub.


## Follow-up fix report — 2026-09-04

Implemented the reviewer follow-up findings without changing Prisma schema or generated artifacts:

- Redis revocation writes now retain per-key uncertainty on unavailable/failed writes. Revocation reads return the DB-fallback sentinel for uncertain keys, and JWT REST/WebSocket validation performs authoritative session/device validation whenever Redis does not positively report a revocation. This prevents a failed revocation write followed by a normal Redis miss from accepting a revoked token.
- Delivery completion/failure and cancellation now claim terminal state with conditional `updateMany` predicates inside Prisma transactions. Audit writes are in the same transaction, so concurrent completion/cancellation has one winner.
- Route selection and manual reorder now lock the delivery row with `FOR UPDATE`, claim idempotency inside the same transaction before route creation, and update the claim with the result. Unique-key races return the committed cached response; concurrent route mutations cannot allocate the same version or apply the same idempotent mutation twice. Existing `@@unique([deliveryId, version])` and `@@unique([key, userId, endpoint])` constraints remain the final database guards.
- WebRTC responses reject expired sessions. Accept and timeout both use conditional status/expiry predicates, and timeout broadcasts only after winning its conditional update.
- WebRTC signaling authorization uses the actual Socket.IO `client.rooms` membership rather than only the bookkeeping set; accepted sockets await the room join.
- Added regression coverage for Redis write failure plus normal reads, revoked-session DB outcomes, delivery terminal races, route idempotency ordering and concurrent duplicate requests, expired WebRTC responses, accept/timeout races, and actual Socket.IO room membership.

The unresolved tenant/company schema requirement remains intentionally deferred. The Prisma schema still has no tenant/company relation or safe fleet ownership key, so this change does not attempt a migration, backfill, or query-wide tenant propagation.

### Exact validation commands and output

```text
$ cd /tmp/distribution-system-armada-review/backend && npm test -- --runInBand
> distribution-system-backend@1.0.0 test
> jest --config ./test/jest-unit.json --runInBand
Test Suites: 8 passed, 8 total
Tests:       62 passed, 62 total

$ cd /tmp/distribution-system-armada-review/backend && npm run build
> distribution-system-backend@1.0.0 build
> nest build

$ cd /tmp/distribution-system-armada-review/backend && npm run test:e2e -- --runInBand test/security/logic-code-fixes.spec.ts test/routes/routes-rest.e2e-spec.ts test/communication/webrtc-session.e2e-spec.ts
> distribution-system-backend@1.0.0 test:e2e
> jest --config ./test/jest-e2e.json --runInBand test/security/logic-code-fixes.spec.ts test/routes/routes-rest.e2e-spec.ts test/communication/webrtc-session.e2e-spec.ts
Test Suites: 2 passed, 2 total
Tests:       15 passed, 15 total

$ cd /tmp/distribution-system-armada-review/backend && npm run test:e2e -- --runInBand
> distribution-system-backend@1.0.0 test:e2e
> jest --config ./test/jest-e2e.json --runInBand
Test Suites: 42 passed, 42 total
Tests:       154 passed, 154 total

$ cd /tmp/distribution-system-armada-review/backend && npm run lint
> distribution-system-backend@1.0.0 lint
> eslint "{src,test,spikes}/**/*.ts" --fix
ESLint: 6.4.0.
ESLint couldn't find a configuration file.
```

The targeted and full e2e runs also printed the repository's existing asynchronous-handle notice after completion; all suites and assertions passed. The lint command is blocked by the pre-existing missing ESLint configuration, unrelated to these changes.


## Important issue follow-up — 2026-09-04

Fixed the remaining Important review findings without changing the Prisma schema, adding a tenant migration, or modifying generated artifacts:

- Owner `skipStop` mutations now require `Delivery.createdBy` to match the acting owner. Admin and super-admin operational access remains unchanged.
- POD idempotency lookup now precedes terminal-delivery rejection, and already-delivered stops remain safe retry responses. New POD submissions against terminal deliveries still return `INVALID_DELIVERY_STATE` before any write.
- Accepted WebRTC invites now receive a one-hour active lifetime, separate from the 30-second unanswered-invite deadline. The pending timeout remains conditional and cannot expire an accepted session.
- Realtime revocation now indexes all sockets per session and device, disconnects every matching socket, and revalidates the database session, device, account, role, and revocation state before sensitive room, telemetry, chat, and WebRTC operations. Invalid existing sockets receive an authorization error and are disconnected.
- Uncertain Redis revocation keys now carry a bounded 15-minute memory TTL and oldest-entry eviction at a 10,000-key cap; expired entries are pruned before reads and writes.

The tenant/company schema requirement remains explicitly deferred as requested. No Prisma migration or generated artifact was introduced.

### Validation

- Focused regression suite: `./node_modules/.bin/jest --config ./test/jest-unit.json test/security/logic-code-fixes.spec.ts --runInBand` — 23 passed.
- Unit suite: `npm test -- --runInBand` — 8 suites, 68 tests passed.
- Build: `npm run build` — passed.
- Relevant e2e: `npm run test:e2e -- --runInBand test/deliveries/pod-upload.e2e-spec.ts test/deliveries/stop-lifecycle.e2e-spec.ts test/communication/webrtc-session.e2e-spec.ts test/communication/ws-webrtc-signaling.e2e-spec.ts test/realtime/ws-instant-revocation.e2e-spec.ts test/realtime/ws-room-authorization.e2e-spec.ts` — 6 suites, 30 tests passed.
