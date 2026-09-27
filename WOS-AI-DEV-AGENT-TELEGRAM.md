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
READ_ONLY -> EDIT_DEV -> RUN_TESTS -> human approval -> COMMIT -> human approval -> PUSH -> human approval -> DEPLOY

Notification states:
- PASS
- FAIL
- NEED APPROVAL
- INFO
