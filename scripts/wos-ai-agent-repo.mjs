#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(name);

function run(command, commandArgs = []) {
  try {
    const output = execFileSync(command, commandArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message };
  }
}

function trackedFiles() {
  const result = run("git", ["ls-files"]);
  if (!result.ok) throw new Error(`Unable to inspect Git index: ${result.output}`);
  return result.output.split(/\r?\n/).filter(Boolean);
}

function queryTerms(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function isSearchableFile(file) {
  if (/(^|[\\/])(?:\.git|node_modules)(?:[\\/]|$)/i.test(file)) return false;
  if (/(^|[\\/])\.env(?:\.|$)/i.test(file)) return false;

  return /\.(?:js|mjs|cjs|ts|tsx|json|md|ps1|yml|yaml|css|sql|toml)$/i.test(file);
}

function searchableContent(file) {
  if (!isSearchableFile(file)) return "";

  const absolute = path.resolve(ROOT, file);
  if (!absolute.startsWith(ROOT + path.sep) && absolute !== ROOT) return "";
  if (!existsSync(absolute)) return "";

  try {
    if (statSync(absolute).size > 256 * 1024) return "";
    return readFileSync(absolute, "utf8").toLowerCase();
  } catch {
    return "";
  }
}

function score(file, terms) {
  const lowerPath = file.toLowerCase();
  const content = searchableContent(file);

  return terms.reduce((total, term) => {
    const t = term.toLowerCase();

    let points = 0;

    if (lowerPath === t) points += 8;
    else if (lowerPath.includes(t)) points += 3;

    if (content.includes(t)) points += 2;

    return total + points;
  }, 0);
}

function rankedMatches(files, query, limit) {
  const terms = queryTerms(query);
  if (!terms.length) return [];

  return files
    .map((file) => ({ file, score: score(file, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, limit);
}

function category(files, name, predicate) {
  const matches = files.filter(predicate);
  console.log(`${name} (${matches.length})`);
  for (const file of matches.slice(0, 40)) console.log(`- ${file}`);
  if (matches.length > 40) console.log(`- ... ${matches.length - 40} more`);
  console.log("");
}

const files = trackedFiles();
const query = arg("--query");
const limit = Math.min(50, Math.max(1, Number.parseInt(arg("--limit", "20"), 10) || 20));

if (has("--help")) {
  console.log("WOS AI Dev Agent Repository Intelligence");
  console.log("--query <task> ranks tracked files relevant to a task without changing files.");
  console.log("--limit <n> limits ranked results (1-50).");
  console.log("--json emits machine-readable inventory.");
  process.exit(0);
}

const inventory = {
  totalTrackedFiles: files.length,
  aiCore: files.filter((f) => f.startsWith("src/lib/ai/")),
  aiRoutes: files.filter((f) => /src[\\/]app[\\/]api[\\/].*(ai|chat)/i.test(f)),
  apiRoutes: files.filter((f) => /src[\\/]app[\\/]api[\\/].*[\\/]route\\.(ts|tsx|js|mjs)$/i.test(f)),
  supabase: files.filter((f) => /supabase|migrations|sql/i.test(f)),
  notion: files.filter((f) => /notion/i.test(f)),
  hotel: files.filter((f) => /hotel|room|availability/i.test(f)),
  booking: files.filter((f) => /booking|order/i.test(f)),
  agent: files.filter((f) => /wos-ai-agent|ai-dev-agent/i.test(f)),
};

if (has("--json")) {
  const result = { generatedAt: new Date().toISOString(), inventory };
  if (query) {
    result.query = query;
    result.matches = rankedMatches(files, query, limit);
  }
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log("WOS AI Dev Agent Repository Intelligence");
console.log("");
console.log(`Tracked files: ${files.length}`);
console.log(`Working tree mutation: NONE`);
console.log(`Secrets/environment values read: NO`);
console.log("");

category(files, "AI Core", (f) => f.startsWith("src/lib/ai/"));
category(files, "AI / Chat API", (f) => /src[\\/]app[\\/]api[\\/].*(ai|chat)/i.test(f));
category(files, "Supabase / Data", (f) => /supabase|migrations|sql/i.test(f));
category(files, "Notion / Knowledge", (f) => /notion/i.test(f));
category(files, "Hotel / Availability", (f) => /hotel|room|availability/i.test(f));
category(files, "Booking / Orders", (f) => /booking|order/i.test(f));
category(files, "Agent / Automation", (f) => /wos-ai-agent|ai-dev-agent|preflight|regression/i.test(f));

if (query) {
  const matches = rankedMatches(files, query, limit);
  console.log(`Task relevance: ${query}`);
  console.log("");
  if (!matches.length) console.log("No path-level matches found; inspect architecture before editing.");
  else matches.forEach((item, index) => console.log(`${index + 1}. [${item.score}] ${item.file}`));
}

console.log("");
console.log("REPOSITORY_INTELLIGENCE PASS");
console.log("Read-only: no files, Git history, commit, push, or Production state changed.");
