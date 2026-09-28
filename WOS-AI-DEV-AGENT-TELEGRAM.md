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

## Phase 2B — Human Approval Git Safety
- `npm run ai:dev-agent:git -- --mode verify` checks diff, protected paths, and branch without changing files.
- Commit requires `--approve-commit` plus an explicit file allowlist and commit message.
- Push requires a separate `--approve-push`, a clean working tree, an upstream branch, and a non-default branch.
- Commit never pushes. Push never deploys.
- Production deployment remains outside this gate and requires the Production Deployment Gate plus separate human approval.
