# Package promotion rollout artifacts

These files are standalone candidates. No production execution occurred during this local qualification. Do not replay `supabase/migrations/`: it contains a separate disposable-local Phase 2 candidate that deliberately rejects production.

- Phase 1: `supabase/candidates/20261027000000_packages_promotion_upgrade.sql` is a byte-identical copy of the original approved backfill. It never overwrites non-null canonical values. Verify current schema, counts, history and writers first. If Phase 1 is already complete, verify its state rather than replay it.
- Phase 2: `supabase/candidates/20261028000000_packages_search_promotion_production.sql` accepts the qualified legacy SQL body with LF or CRLF, and preserves the installed body's raw line endings. Its only body change is `p.is_promotion` to `p.promotion`. It retains output `is_promotion`, `duration text`, argument defaults, owner, ACL and invoker security. Unknown bodies/signatures fail closed; unexpected attribute changes roll back the transaction.
- Previous artifacts remain unchanged for audit. Do not execute the superseded `20261027000002` candidate against a CRLF baseline. Do not execute the disposable-local `20261027000001` migration in production.

## Local verification

From the repository root, with installed dependencies and a local Docker engine:

```powershell
npm run test:promotion:local
npx --no-install vitest run src
npx --no-install tsc --noEmit --incremental false
git diff --check
```

The SQL runner requires the cached `pgvector/pgvector:pg16` image (or a cached image selected with `WOS_PROMOTION_TEST_IMAGE`). It never pulls an image. It explicitly uses the local Docker socket, creates a uniquely labelled container with no network/host mounts/published ports, and uses ephemeral PostgreSQL data. Each SQL call checks container identity, label, isolation and mounts. Cleanup stops only the container created by that run and deletes only its verified temporary Docker-config directory.

The SQL suite is skipped in ordinary Vitest runs; use the explicit runner to execute it. It checks LF/CRLF byte preservation, true/false disagreement, backfill/rerun, canonical-only storage, interface/ACL/security, search semantics, mismatch rejection and atomic rollback. Repository-contract tests and Admin/Partner save-handler tests run in the ordinary source suite. The latter use the actual extracted save handlers and mocked transport; they are not browser/PostgREST end-to-end tests.

## Before any future production execution

Production/push/deploy are outside the authorization for this local closure. Obtain authorization for the new artifact/hash and an authenticated connection targeting project `ayjtfbmatwpyoxayrpxs`. Inspect live migration history/state, exact RPC body/interface/security/grants, both flags/counts, triggers/RLS/dependencies and remaining legacy writers. Stop on any mismatch or missing evidence. A local test result is not production verification.

Preserve `is_promotion`; no drop/rename, dual-write, synchronization, grants changes or unrelated cleanup is part of these artifacts. Phase 2 is intentionally single-use and rejects an already canonical body. Verify live RPC output and true/false smoke counts after any separately authorized execution. Do not claim migration history entries exist when SQL was executed outside the migration-history tool.
