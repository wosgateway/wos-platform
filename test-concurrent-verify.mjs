#!/usr/bin/env node
/**
 * test-concurrent-verify.mjs
 *
 * Fires N concurrent POST requests at a payment verify (or reject)
 * endpoint to prove the atomic-claim fix actually holds under real
 * concurrency, not just in code review.
 *
 * Expected result on a CORRECT endpoint (after migration 022 + the
 * updated route.ts files):
 *   - Exactly 1 request returns 200 (the winner that claimed the payment)
 *   - All other requests return 409 (payment already handled)
 *   - The order/order_item balance increases by exactly ONE payment's
 *     amount, not N times
 *
 * If you see 2+ requests return 200, the atomic claim is NOT working
 * and the deposit was very likely double-counted  do not deploy.
 *
 * Requirements: Node.js 18+ (built-in fetch). No npm install needed.
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { n: 10, method: 'POST', body: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--url') out.url = args[++i];
    else if (a === '--cookie') out.cookie = args[++i];
    else if (a === '--n') out.n = parseInt(args[++i], 10);
    else if (a === '--body') out.body = args[++i];
    else if (a === '--header') {
      out.extraHeaders = out.extraHeaders || {};
      const [k, ...rest] = args[++i].split(':');
      out.extraHeaders[k.trim()] = rest.join(':').trim();
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(1);
    }
  }
  if (!out.url) {
    console.error('Missing required --url "<full endpoint URL>"');
    process.exit(1);
  }
  if (!out.cookie) {
    console.warn(
      '  No --cookie supplied. The request will very likely come back 401 Unauthorized ' +
        'unless the endpoint is unauthenticated.'
    );
  }
  return out;
}

async function fireOne(url, headers, body, index) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: body ?? undefined,
    });
    const elapsed = Date.now() - started;
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { index, status: res.status, ok: res.ok, body: json, elapsedMs: elapsed };
  } catch (err) {
    const elapsed = Date.now() - started;
    return { index, status: null, ok: false, error: String(err), elapsedMs: elapsed };
  }
}

async function main() {
  const { url, cookie, n, body, extraHeaders } = parseArgs();

  const headers = {
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
    ...(extraHeaders || {}),
  };

  console.log(`\n=== Concurrent Verify Test ===`);
  console.log(`URL:         ${url}`);
  console.log(`Concurrency: ${n} simultaneous requests`);
  console.log(`Firing...\n`);

  const promises = [];
  for (let i = 0; i < n; i++) {
    promises.push(fireOne(url, headers, body, i));
  }
  const results = await Promise.all(promises);
  results.sort((a, b) => a.elapsedMs - b.elapsedMs);

  const successes = results.filter((r) => r.status === 200);
  const conflicts = results.filter((r) => r.status === 409);
  const authFailures = results.filter((r) => r.status === 401 || r.status === 403);
  const notFound = results.filter((r) => r.status === 404);
  const otherErrors = results.filter(
    (r) => !r.status || (r.status !== 200 && r.status !== 409 && r.status !== 401 && r.status !== 403 && r.status !== 404)
  );

  console.log('--- Individual results (sorted by response time) ---');
  for (const r of results) {
    const tag = r.status === 200 ? ' 200' : r.status === 409 ? ' 409' : `  ${r.status ?? 'ERR'}`;
    const detail = r.body?.error || r.body?.message || r.error || '';
    console.log(`  [req ${r.index}] ${tag}  (${r.elapsedMs}ms)  ${detail}`);
  }

  console.log('\n--- Summary ---');
  console.log(`  200 OK (claimed):     ${successes.length}`);
  console.log(`  409 Conflict:         ${conflicts.length}`);
  console.log(`  401/403 (auth issue): ${authFailures.length}`);

  console.log('\n--- Verdict ---');
  if (successes.length === 1 && conflicts.length === n - 1 - authFailures.length - notFound.length) {
    console.log(' PASS  exactly one request won the claim, everyone else got 409. Atomic claim is working correctly.');
  } else if (successes.length > 1) {
    console.log(` FAIL  ${successes.length} requests all returned 200 for the SAME payment. DO NOT DEPLOY.`);
  } else {
    console.log('  Check individual results / auth status.');
  }
  console.log('');
}

main();
