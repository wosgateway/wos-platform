// Regression gate for the Understanding layer.  Run from the repo root:
//   npx tsx eval/run.ts            (needs LITELLM_* / OPENAI_* env, same as core.ts)
//   npx tsx eval/run.ts --lock     (write the achieved pass rate to eval/baseline.json)
// Exit code 1 when the pass rate drops below baseline OR any H- (hallucination) case fails.
import fs from 'node:fs';
import path from 'node:path';
import { decide, type DecideContext } from '../src/lib/ai/understanding/orchestrator';
import { type ProvinceRecord } from '../src/lib/ai/understanding/provinces';
import { createUnderstandLlm } from '../src/lib/ai/understanding/llm';
import { understand } from '../src/lib/ai/understanding/understand';
import { catalogMatchesHistory } from '../src/lib/ai/understanding/orchestrator';

const dir = path.join(process.cwd(), 'eval'); // run from the repo root
const fx = JSON.parse(fs.readFileSync(path.join(dir, 'provinces.fixture.json'), 'utf8')) as { covered: string[]; provinces: ProvinceRecord[] };
const cases = fs.readFileSync(path.join(dir, 'cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const baselinePath = path.join(dir, 'baseline.json');
const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : { pass_rate: 0 };
const deps = { provinces: fx.provinces, coveredProvinceIds: new Set(fx.covered) };

(async () => {
  const llm = createUnderstandLlm();
  let pass = 0;
  const fails: string[] = [];
  for (const c of cases) {
    const x = c.context ?? {};
    const history = x.history ?? [];
    const trusted = (x.recent_catalog ?? []).length > 0 && catalogMatchesHistory(x.recent_catalog, history);
    const ctx: DecideContext = {
      recentCatalog: trusted ? x.recent_catalog : [],
      catalogOffset: x.catalog_offset ?? 0,
      catalogQuery: x.catalog_query ?? null,
      selectedProgramId: null,
      journeyProvinceId: x.journey_province ?? null,
    };
    const { understanding: u, error } = await understand(llm, c.input, history, ctx.recentCatalog, 20000);
    const a = u ? decide(u, c.input, ctx, deps) : ({ type: 'DEFER', reason: error ?? 'understand_failed' } as const);
    const e = c.expect;
    const provId = 'province' in a ? (a as { province: ProvinceRecord | null }).province?.id ?? null : null;
    const ok =
      (u?.intent ?? 'UNKNOWN') === e.intent &&
      a.type === e.action &&
      (e.province === undefined || provId === e.province) &&
      (e.selection_index === undefined || u?.entities.selection_index === e.selection_index);
    if (ok) pass++;
    else fails.push(`${c.id} "${c.input}" -> ${u?.intent ?? 'ERR'}/${a.type}${provId ? '/' + provId : ''}  (expected ${e.intent}/${e.action}${e.province ? '/' + e.province : ''})`);
  }
  const rate = pass / cases.length;
  console.log(`pass ${pass}/${cases.length} = ${(rate * 100).toFixed(1)}%  (baseline ${(baseline.pass_rate * 100).toFixed(1)}%)`);
  fails.forEach((f) => console.log('FAIL', f));
  if (process.argv.includes('--lock')) {
    fs.writeFileSync(baselinePath, JSON.stringify({ pass_rate: Number(rate.toFixed(4)), cases: cases.length, locked_at: new Date().toISOString() }, null, 2));
    console.log('baseline locked');
    return;
  }
  const hall = fails.filter((f) => f.startsWith('H-')).length;
  if (rate < baseline.pass_rate || hall > 0) process.exit(1);
})();
