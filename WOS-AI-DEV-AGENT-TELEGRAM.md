# WOS AI Dev Agent - Telegram Notification

Telegram notifications are sent by scripts/telegram-notify.mjs.

Required local environment variables:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

Security:
- Never commit either variable.
- Never print their values.
- Never include them in logs, reports, or Telegram messages.
- Keep notification scripts free of secrets.

Workflow:
READ_ONLY -> PLAN -> EDIT_DEV -> VERIFY_CHANGE -> RUN_TESTS -> human approval -> COMMIT -> human approval -> PUSH -> human approval -> DEPLOY

Notification states:
- PASS
- FAIL
- NEED APPROVAL
- INFO

## Phase 2B � Human Approval Git Safety
- `npm run ai:dev-agent:git -- --mode verify` checks diff, protected paths, and branch without changing files.
- Commit requires `--approve-commit` plus an explicit file allowlist and commit message.
- Push requires a separate `--approve-push`, no tracked/staged changes, an upstream branch, and a non-default branch; pre-existing untracked WIP is allowed and is not included in the push.
- Commit never pushes. Push never deploys.
- Production deployment remains outside this gate and requires the Production Deployment Gate plus separate human approval.


## Phase 2C — Production Gate Integration
- `--mode production-gate` runs the Production Deployment Gate and never deploys.
- The gate covers Preflight, AI Regression, and Production Target Guard.
- Human approval remains required before production deployment.

## Phase 2D — Controlled Production Deploy
- `--mode production-deploy --approve-deploy` is the only Agent deployment path.
- Deployment is blocked without the explicit `--approve-deploy` flag.
- Tracked/staged Git changes are blocked; pre-existing untracked WIP is not included.
- The deploy script archives exact Git `HEAD` into a temporary staging directory, so unrelated untracked WIP cannot be deployed.
- The full Production Deployment Gate runs before Vercel deployment.
- Vercel target is pinned to project `wos-platform-updated` and alias `www.wos.asia`.
- After deployment, the new deployment is inspected and must be production, READY, and attached to `www.wos.asia`.
- Failed gate or failed verification blocks the workflow; no automatic rollback is performed.


## Phase 2E — Production Recovery Check
- `--mode production-recovery-check` runs `production:rollback:check` in read-only mode.
- It verifies the current production deployment and identifies an older READY deployment candidate.
- No rollback or deployment is performed by this mode.
- Any rollback action remains a separate human-approved operation.

## Phase 2F — Production Post-Deploy Smoke Check
- `npm run production:smoke:check` is a read-only verification of the live production target.
- It verifies project `wos-platform-updated`, production target, READY state, and alias `www.wos.asia`.
- It performs a GET request to `https://www.wos.asia/` and requires HTTP 200 with an HTML response.
- It rejects an unexpectedly small response or common application/runtime error markers.
- `--mode production-smoke-check` runs the same check through the AI Dev Agent and sends separate Telegram notifications.
- No deployment or rollback is performed by this mode.
## Phase 2G — Controlled Production Rollback
- npm run production:rollback -- --approve-rollback --deployment <deployment-id-or-url> is the only rollback execution path.
- --approve-rollback is mandatory; the target deployment must be supplied explicitly.
- The script verifies the current production alias before changing anything.
- The explicit target must belong to project wos-platform-updated, be READY, and be older than current production.
- The target must not already be the current production deployment.
- Tracked or staged Git changes block rollback; untracked WIP is not used by the rollback action.
- Vercel rollback is executed only after all preconditions pass.
- The script then re-inspects www.wos.asia and requires the alias to point to the exact approved target.
- There is no automatic retry and no automatic alternate-target selection.
- --mode production-rollback --approve-rollback --deployment <deployment-id-or-url> exposes the same controlled action through WOS AI Dev Agent.
- After rollback, --mode production-smoke-check must be run before declaring recovery complete.
- Rollback is an operational action, not a deployment or rebuild; Vercel documents Instant Rollback as traffic rerouting to an existing immutable deployment.


## Phase 2H — Controlled Production Recovery
- `npm run production:recover -- --approve-recovery --deployment <deployment-id-or-url>` is the single recovery orchestration path.
- `--approve-recovery` and an explicit rollback target are mandatory.
- Recovery delegates to the existing controlled rollback safety checks; it does not select a target automatically.
- After a successful rollback, the same workflow immediately runs the production smoke check.
- Recovery is PASS only when the approved target is active and the post-recovery smoke check passes.
- There is no automatic retry or alternate-target selection.
- `--mode production-recover --approve-recovery --deployment <id-or-url>` exposes the same controlled workflow through WOS AI Dev Agent.
- Tracked/staged Git changes remain blocked by the rollback safety gate; untracked WIP is not used by recovery.


## Phase 2I — Operational Control
- `npm run ai:dev-agent:status` is a read-only operational audit.
- It reports branch, HEAD, remote HEAD, upstream state, Git diff check, working-tree state, Production target guard, live production smoke status, and rollback candidate status.
- Untracked WIP is reported only; it is not used by controlled deploy or recovery paths.
- AI regression is optional with `--include-regression` because it requires the local regression test server.
- `--mode operational-status [--include-regression]` exposes the same audit through WOS AI Dev Agent and sends separate Agent notifications.
- `node scripts/wos-ai-agent-status.mjs --incident` prints the operational incident runbook without changing files or Production.
- Production incidents follow smoke check → recovery check → explicit target selection → human approval → controlled recovery → post-recovery smoke verification.
- No automatic rollback, retry, alternate target selection, commit, push, or deployment is introduced by Phase 2I.

## Phase 2J — Audit / History
- `npm run ai:dev-agent:audit` is a read-only audit/history view for Git and Production deployment history.
- It reports branch, HEAD, remote HEAD, upstream state, working-tree state, recent Git commits, and recent Production deployments.
- Production history is read from the pinned Vercel project `wos-platform-updated`; only deployments marked with the Production target are shown.
- `--limit <n>` controls history entries (1–100); `--since <date>` scopes Git history; `--json` emits machine-readable output.
- `--mode audit-history [--limit <n>] [--since <date>] [--json]` exposes the same audit through WOS AI Dev Agent.
- The audit never commits, pushes, deploys, rolls back, recovers, or changes files.
- Secrets and environment values are never printed.
- Audit output is observational history only and does not replace explicit human approval for state-changing actions.
