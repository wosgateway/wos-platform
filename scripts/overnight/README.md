# WOS AI Agent (DEV only: never stages, commits, pushes or deploys)

package.json scripts:
  "ai:agent": "node scripts/wos-ai-agent-run.mjs",
  "ai:agent:commit": "node scripts/wos-ai-agent-approve.mjs",
  "ai:overnight": "node scripts/wos-ai-overnight.mjs",
  "ai:overnight:selftest": "node --test scripts/overnight/overnight.selftest.mjs"

One command (reproduce -> root cause -> layer check -> patch -> verify -> report -> STOP):
  git switch -c ai/agent-YYYYMMDD
  npm run dev                                   (dev server for the regression suite)
  npm run ai:agent -- "bug description" --base-url http://localhost:3001
  (Thai text: put it in a UTF-8 file and use --task-file task.txt)

After a PASS you review `git diff`; to approve exactly what the agent reported:
  npm run ai:agent:commit -- --message "fix: ..."     (Telegram approval + explicit file list; no push, no deploy)

Rules enforced in code (not just in the prompt): see contract.md. Definition of Done is printed in every report.
Exit codes: 0 PASS, 2 BLOCKED, 3 TIMEOUT. Add `.overnight/` to .gitignore.
