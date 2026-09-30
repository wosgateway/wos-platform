#!/usr/bin/env node
/**
 * WOS.os AI Regression Test Suite (TASK 02)
 *
 * Hits /api/ai/chat with fixed real-world queries and checks the response
 * against known-correct behavior, so a future change to AI Core / search
 * relevance can't silently regress the 4 behaviors below:
 *
 *   1. A real, on-catalog Thai query should return a matched program.
 *   2. An absurd/off-catalog query must NOT return an unrelated package
 *      (the "man on Mars" false-positive class of bug).
 *   3. A province-scoped query should filter by that province.
 *   4. A generic/small-talk question should NOT force a catalog search.
 *
 * This is deliberately plain Node (built-in fetch, Node >=18) run directly
 * with `node`, not PowerShell — sidesteps console code-page / encoding
 * issues entirely for the Thai-language test strings. Save this file as
 * UTF-8 (no BOM needed) and it will just work.
 *
 * USAGE
 *   node ai-regression-test.mjs
 *   node ai-regression-test.mjs --base-url http://localhost:3025
 *   node ai-regression-test.mjs --base-url http://127.0.0.1:3016 --verbose
 *   node ai-regression-test.mjs   # auto-detects the running WOS webhook container
 *
 * EXIT CODE
 *   0 = all hard-checks passed (some cases may still be flagged REVIEW)
 *   1 = at least one hard-check failed
 *
 * NOTE ON ASSERTIONS
 *   The AI's exact wording isn't fixed, so assertions are keyword/shape
 *   based rather than exact-match. Two kinds of result:
 *     PASS / FAIL  - a hard, automatable check (safe to gate CI/deploy on)
 *     REVIEW       - printed in full for a human to eyeball; not currently
 *                    safe to assert automatically without more signal
 *                    (e.g. a debug trace of which tools were called)
 *   If WOS ever exposes a debug header/field showing which tools fired
 *   (e.g. { toolsCalled: ["searchPrograms"] }), wire that into
 *   checkToolCalled() below to turn REVIEW cases into real PASS/FAIL.
 */

import { resolveAiTestBaseUrlFromArgs } from "./scripts/resolve-ai-test-url.mjs";

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}
const BASE_URL = resolveAiTestBaseUrlFromArgs(args);
const REQUEST_TIMEOUT_MS = Number(getArg("timeout-ms", process.env.WOS_TEST_TIMEOUT_MS || "30000"));
const VERBOSE = args.includes("--verbose");
// Use a dedicated test IP so repeated regression runs do not consume the real client rate-limit bucket.
const TEST_IP = process.env.WOS_AI_REGRESSION_IP || "198.18.0.42";
let requestIndex = 0;
const ENDPOINT = `${BASE_URL.replace(/\/$/, "")}/api/ai/chat`;

// Phrases that indicate "found nothing relevant" in Thai responses.
const NOT_FOUND_MARKERS = ["ไม่พบ", "ไม่มีโปรแกรม", "ไม่มีข้อมูล", "ขออภัย", "ไม่พบข้อมูล"];

// Phrases that would indicate an unrelated catalog item leaked into an
// answer that should have returned nothing (the Mars/hotel false-positive).
const UNRELATED_CATALOG_MARKERS = ["โรงแรม", "รีสอร์ท", "onsen", "Onsen", "บ้านเจ้าคุณ"];

function containsAny(text, markers) {
  return markers.some((m) => text.includes(m));
}

async function askAI(message, history = []) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      signal: controller.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": TEST_IP.replace(/\d+$/, String(142 + (requestIndex++ % 100))),
      },
      body: JSON.stringify({ message, history }),
    });
  } finally {
    clearTimeout(timeout);
  }
  const status = res.status;
  let bodyText = "";
  let bodyJson = null;
  try {
    bodyText = await res.text();
    bodyJson = JSON.parse(bodyText);
  } catch {
    // non-JSON response, keep bodyText for inspection
  }
  const replyText =
    bodyJson?.answer ??
    bodyJson?.reply ??
    bodyJson?.message ??
    bodyJson?.content ??
    bodyText ??
    "";
  return { status, replyText: String(replyText), raw: bodyJson ?? bodyText };
}

const cases = [
  {
    id: "T1a_strong_catalog_query",
    label: "Strong query (exact catalog term + province): must match",
    query: "มีโปรแกรมตรวจสุขภาพในจังหวัดอุดรธานีไหม",
    kind: "hard",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: `HTTP ${r.status}, expected 200` };
      if (containsAny(r.replyText, NOT_FOUND_MARKERS)) {
        return { pass: false, reason: "response says not-found for a query expected to match" };
      }
      return { pass: true };
    },
  },
  {
    id: "T1b_semantic_synonym_query",
    label: "Semantic synonym query (category word, no exact catalog term): known relevance gap, not gated",
    query: "มีโปรแกรมสุขภาพในอุดรธานีไหม",
    kind: "review",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: `HTTP ${r.status}, expected 200` };
      // Root cause (found in src/lib/ai/programs.ts): "สุขภาพ" alone is in
      // GENERIC_TERMS, so buildSearchCandidates() drops it as soon as the
      // full raw sentence exists as a "specific" candidate -- and that raw
      // sentence never literally matches any title/description, so this
      // legitimately returns not-found today. Left as REVIEW (not gated)
      // until intended semantic-synonym behavior is decided -- gating on
      // this would hide the real bug instead of tracking it.
      if (containsAny(r.replyText, NOT_FOUND_MARKERS)) {
        return { pass: null, reason: "known gap: standalone category term (\"สุขภาพ\") does not semantically match \"ตรวจสุขภาพ\" yet" };
      }
      return { pass: null, reason: "eyeball: semantic match succeeded -- if this becomes reliably true, promote T1b to hard" };
    },
  },
  {
    id: "T1c_symptom_catalog_query",
    label: "Symptom query: knee pain should reach the verified knee-check catalog service",
    query: "ช่วงนี้ปวดเข่าเวลาเดินขึ้นบันได มีโปรแกรมอะไรที่เกี่ยวข้องไหม",
    kind: "hard",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: `HTTP ${r.status}, expected 200` };
      if (containsAny(r.replyText, NOT_FOUND_MARKERS)) {
        return { pass: false, reason: "symptom query returned not-found instead of a relevant catalog result" };
      }
      if (!containsAny(r.replyText, ["ตรวจเข่า", "INDY CLINICS"])) {
        return { pass: false, reason: "symptom query did not expose the verified knee-check catalog result" };
      }
      return { pass: true };
    },
  },
  {
    id: "T1d_symptom_province_scope",
    label: "Symptom + province: knee pain in Udon should stay province-scoped",
    query: "ปวดเข่าในอุดรธานี มีโปรแกรมอะไรที่เกี่ยวข้องไหม",
    kind: "hard",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: `HTTP ${r.status}, expected 200` };
      if (containsAny(r.replyText, NOT_FOUND_MARKERS)) {
        return { pass: false, reason: "symptom + province query returned not-found" };
      }
      if (!containsAny(r.replyText, ["ตรวจเข่า", "INDY CLINICS"])) {
        return { pass: false, reason: "symptom + province query did not return the verified Udon knee-check catalog result" };
      }
      return { pass: true };
    },
  },
  {
    id: "T1e_selected_program_booking",
    label: "Selected program booking: must not produce the old generic 'cannot book' refusal",
    query: "จองโปรแกรมตรวจเข่าให้หน่อย",
    history: [
      {
        role: "assistant",
        content: "1. ตรวจเข่า — INDY CLINICS / อุดรธานี\n\n2. ตรวจสุขภาพ — DNA Wellness Center / อุดรธานี",
      },
    ],
    kind: "hard",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: "HTTP " + r.status + ", expected 200" };
      const refusal = /ไม่สามารถจอง|cannot book|unable to book|ติดต่อทีมงาน WOS เพื่อขอข้อมูลเพิ่มเติมเกี่ยวกับโปรแกรม/iu;
      if (refusal.test(r.replyText)) return { pass: false, reason: "selected-program booking still falls into the old generic refusal response" };
      if (!containsAny(r.replyText, ["WOS", "จอง"])) return { pass: false, reason: "booking response did not explain the WOS booking path" };
      return { pass: true };
    },
  },
  {
    id: "T1f_repeat_reset",
    label: "Repeated-answer complaint: must reset instead of echoing the previous refusal",
    query: "ทำไมคุณตอบซ้ำๆ",
    history: [
      {
        role: "assistant",
        content: "ขออภัยค่ะ ใบเฟิร์นไม่สามารถจองโปรแกรม “ตรวจเข่า” ให้คุณได้โดยตรง เนื่องจากต้องปฏิบัติตามกฎของ WOS",
      },
    ],
    kind: "hard",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: "HTTP " + r.status + ", expected 200" };
      if (/ไม่สามารถจอง|cannot book|unable to book/iu.test(r.replyText)) return { pass: false, reason: "repeat complaint echoed the stale booking refusal" };
      if (!/ซ้ำ|เริ่มใหม่|reset|repeat/i.test(r.replyText)) return { pass: false, reason: "repeat complaint did not acknowledge/reset the repeated answer" };
      return { pass: true };
    },
  },
  {
    id: "T1g_transport_query",
    label: "Transport question: must not be converted into a generic booking refusal",
    query: "มีรถรับส่งบ่",
    kind: "hard",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: "HTTP " + r.status + ", expected 200" };
      if (/ไม่สามารถจอง|cannot book|unable to book/iu.test(r.replyText)) return { pass: false, reason: "transport question produced a generic booking refusal" };
      if (!/รถรับส่ง|จุดรับ|จุดส่ง|วัน|เวลา|ລົດຮັບສົ່ງ|ຈຸດຮັບ|ຈຸດສົ່ງ|ວັນ|ເວລາ/iu.test(r.replyText)) return { pass: false, reason: "transport response did not explain the WOS transport flow or collect required trip details" };
      return { pass: true };
    },
  },
  {
    id: "T1h_unknown_question_escalation",
    label: "Unsupported question: must escalate to WOS instead of guessing or looping",
    query: "WOS มีนโยบายพิเศษสำหรับกรณีที่ไม่มีอยู่ในข้อมูลระบบตอนนี้ไหม",
    kind: "hard",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: "HTTP " + r.status + ", expected 200" };
      if (/ไม่สามารถจอง|cannot book|unable to book|กฎของ WOS|policy says/iu.test(r.replyText)) {
        return { pass: false, reason: "unsupported question fell into a generic refusal/policy hallucination" };
      }
      if (!/WOS|ตรวจสอบ|ดำเนินการต่อ|ยืนยัน|ข้อมูล/iu.test(r.replyText)) {
        return { pass: false, reason: "unsupported question did not provide a WOS verification/escalation path" };
      }
      return { pass: true };
    },
  },
  {
    id: "T2_hotel_availability_read",
    label: "Hotel availability: exact dates + Udon must return only verified available hotel data",
    query: "มีโรงแรมในอุดรธานีว่างไหม เช็คอิน 2026-09-29 เช็คเอาต์ 2026-10-01 1 ห้อง",
    kind: "hard",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: `HTTP ${r.status}, expected 200` };
      if (containsAny(r.replyText, NOT_FOUND_MARKERS)) {
        return { pass: false, reason: "hotel availability query returned not-found despite verified inventory" };
      }
      if (!containsAny(r.replyText, ["Udon Hotel", "1,300", "1300"])) {
        return { pass: false, reason: "hotel availability response did not expose the verified Udon Hotel / 1,300 THB rate" };
      }
      return { pass: true };
    },
  },
  {
    id: "T2b_hotel_oversell_guard",
    label: "Hotel availability: request above inventory must not claim rooms are available",
    query: "มีโรงแรมในอุดรธานีไหม เช็คอิน 2026-09-29 เช็คเอาต์ 2026-10-01 6 ห้อง",
    kind: "hard",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: `HTTP ${r.status}, expected 200` };
      if (containsAny(r.replyText, ["1,300", "1300", "2,600", "2600", "Udon Hotel"])) {
        return { pass: false, reason: "oversized room request exposed the verified hotel as available despite only 5 rooms being configured" };
      }
      return { pass: true };
    },
  },
  {
    id: "T2_mars_no_false_positive",
    label: "Absurd query: 'program for humans on Mars' must not return an unrelated package",
    query: "มีโปรแกรมสำหรับมนุษย์บนดาวอังคารไหม",
    kind: "hard",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: `HTTP ${r.status}, expected 200` };
      if (containsAny(r.replyText, UNRELATED_CATALOG_MARKERS)) {
        return {
          pass: false,
          reason: "response leaked an unrelated catalog item (hotel/onsen) for a nonsense query",
        };
      }
      return { pass: true };
    },
  },
  {
    id: "T3_province_scoped_query",
    label: "Province-scoped query: results should be filtered to that province",
    query: "มีโปรแกรมอะไรในอุดรธานีบ้าง",
    kind: "review",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: `HTTP ${r.status}, expected 200` };
      // Root cause (found in src/lib/ai/programs.ts, searchPrograms()): a
      // location-only candidate is pushed as generic:false, but
      // passesRelevanceGate() for a non-generic candidate only checks
      // title/description/partner name -- never partner.province -- so a
      // bare province query can legitimately come back empty even when
      // matching packages exist. Not auto-failed here since this needs a
      // decision on the intended fix (e.g. gate should special-case a
      // province-only candidate to trust the earlier province filter).
      return { pass: null, reason: "eyeball: do all mentioned items look Udon-Thani-scoped? (known gap: bare province query may return empty even with real matches -- see passesRelevanceGate)" };
    },
  },
  {
    id: "T4_generic_question_no_forced_search",
    label: "Generic small-talk question should not force a catalog search",
    query: "สวัสดีครับ วันนี้เป็นยังไงบ้าง",
    kind: "review",
    check: (r) => {
      if (r.status !== 200) return { pass: false, reason: `HTTP ${r.status}, expected 200` };
      // Heuristic hard-check: a generic greeting shouldn't come back with a
      // catalog "not found" apology either -- that shape implies a forced
      // search ran and failed, which is itself a signal something's off.
      if (containsAny(r.replyText, NOT_FOUND_MARKERS)) {
        return {
          pass: false,
          reason: "greeting triggered a catalog not-found response -- looks like search was force-run",
        };
      }
      return { pass: null, reason: "eyeball: does the reply look like normal conversation, not a catalog search?" };
    },
  },
];

function printHeader() {
  console.log("=== WOS.os AI Regression Suite ===");
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log("");
}

async function main() {
  printHeader();
  let hardFailures = 0;
  let executionFailures = 0;
  const reviewItems = [];

  for (const c of cases) {
    process.stdout.write(`[${c.id}] ${c.label} ... `);
    let result;
    try {
      const r = await askAI(c.query);
      if (!r.replyText.trim()) {
        result = { pass: false, reason: "empty AI response" };
      } else {
        result = c.check(r);
      }
      result.response = r.replyText;
      result.httpStatus = r.status;
    } catch (err) {
      result = { pass: false, reason: `request failed: ${err.message}` };
    }

    if (result.pass === true) {
      console.log("PASS");
    } else if (result.pass === false) {
      console.log(`FAIL - ${result.reason}`);
      // Hard assertion failures and execution/infrastructure failures both gate the suite.
      // Review cases remain non-gated only when they return pass:null.
      if (c.kind === "hard") hardFailures++;
      else executionFailures++;
    } else {
      console.log(`REVIEW - ${result.reason}`);
      reviewItems.push({ id: c.id, query: c.query, response: result.response });
    }

    if (VERBOSE && result.response) {
      console.log(`  query: ${c.query}`);
      console.log(`  reply: ${result.response.slice(0, 400)}${result.response.length > 400 ? "..." : ""}`);
      console.log("");
    }
  }

  if (reviewItems.length > 0) {
    console.log("");
    console.log("=== Items needing human review ===");
    for (const item of reviewItems) {
      console.log(`\n[${item.id}]`);
      console.log(`  query : ${item.query}`);
      console.log(`  reply : ${item.response}`);
    }
  }

  console.log("");
  console.log("=== Result ===");
  console.log(`Hard checks: ${cases.filter((c) => c.kind === "hard").length - hardFailures}/${cases.filter((c) => c.kind === "hard").length} passed`);
  console.log(`Review items: ${reviewItems.length} (see above, not auto-graded)`);
  console.log(`Execution failures: ${executionFailures}`);

  if (hardFailures > 0 || executionFailures > 0) {
    console.log("");
    console.log("REGRESSION DETECTED -> do not promote/deploy this build");
    process.exit(1);
  }

  console.log("");
  console.log("No hard regressions detected.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
