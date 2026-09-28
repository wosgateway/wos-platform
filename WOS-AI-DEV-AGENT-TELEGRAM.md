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
