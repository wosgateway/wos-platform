# Anonymous web conversation ownership

Local candidate only. The additive migration is not executed in this phase.

## Contract

POST `/api/ai/conversations` with an exact trusted Origin issues a new session
only when no session cookie exists, and atomically creates its owned conversation.
An invalid/expired/revoked existing cookie fails 401; it is never replaced silently.
The response contains only `conversationSelector`. A new credential travels only
in `__Host-wos-ai-session`: HttpOnly, Secure, SameSite=Lax, Path=/, no Domain.
It is 32 random bytes encoded base64url; persistence receives only SHA-256.
The cookie has a fixed 24-hour Max-Age and is not rotated/refreshed during a session.

POST `/api/ai/chat` with `message`, optional `history`, and `conversationSelector`
validates Origin, session, ownership and lifecycle before calling existing core
with an internal `web:<uuid>` ID and channel `web`. Raw `conversationId` and
`conversation_id` fields are rejected. No selector/context means the old stateless
call shape. Failed stateful authorization never downgrades to stateless.
Credentials, verifier and selectors are not added to diagnostic logs or AI inputs.
No production browser UI currently calls this endpoint; no UI is added here.

Trusted origins: https://www.wos.asia and https://wos.asia. Only development adds
http://localhost:3001, matching package.json. Missing/null/untrusted Origins fail
403. Matching uses scheme/host/effective port, not forwarded headers. Secure
cookies are never weakened for local HTTP; use a browser supporting secure
localhost cookies or separately approved HTTPS development infrastructure.

## Database boundary and lifecycle

Service-only RPCs own creation, admission, revocation and cleanup. Browser roles
have no ownership table/RPC access. Direct service-role table permissions are
removed so application changes use the serialized RPC boundary.
Session idle expiry is 30 minutes. Only successful owned-conversation admission
refreshes it, capped by the absolute 24-hour session expiry. Conversation expiry
is fixed at creation +24 hours and never refreshed. Expired/revoked entries cannot
revive. Invalid session =401; invalid conversation = generic404; store error =503.

Admission and revoke lock session then conversation. Time is checked after lock
waits. Successful RPC transaction commit precedes core invocation: earlier committed
revoke denies admission; earlier admitted work may finish after revoke. There is
no attempt to cancel already-admitted inference. Cleanup uses the same lock order.

Cleanup retains records for seven days after effective ownership ends (conversation
or owner-session expiry/revocation). It never deletes AI state. No cleanup scheduler
is installed or run. Session rows remain referential parents until retained ownership
rows are removed in that cleanup transaction.

## Required verification before rollout

Unit mocks and static SQL checks are not proof of database semantics. This phase
executes no migration against any database. Separately authorize a disposable DB
test to verify:

- real role/RLS/function privileges and migration syntax;
- two sessions, multiple conversations, foreign/unknown selector isolation;
- idle/absolute/fixed conversation expiries with controlled time;
- unauthorized requests never update inactivity;
- concurrent revoke-before-admit and admit-before-revoke, with independent DB
  connections and explicit commit barriers, including waiting-lock rechecks;
- creation failure rolls back session and conversation inserts;
- seven-day cleanup and unchanged AI-state rows.

Creation abuse limits, cleanup scheduling and operational rollout need separate
review. No existing AI routing, Chatwoot, province or catalog semantics are changed.
