// Maps repo paths to WOS AI layers so the supervisor can enforce "fix it where it lives".
export const LAYERS = ["understanding", "gate", "orchestrator", "state", "catalog", "concierge", "handoff", "core-legacy", "other"];

export function layerOf(file) {
  const n = String(file).replace(/\\/g, "/");
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(n)) return "test";
  if (/^src\/lib\/ai\/understanding\/(understand|llm|types|provinces)\.ts$/.test(n)) return "understanding";
  if (/^src\/lib\/ai\/understanding\/gate\.ts$/.test(n)) return "gate";
  if (/^src\/lib\/ai\/understanding\/orchestrator\.ts$/.test(n)) return "orchestrator";
  if (/^src\/lib\/ai\/understanding\/state\.ts$/.test(n) || /^src\/lib\/ai\/journey-state\.ts$/.test(n)) return "state";
  if (/^src\/lib\/ai\/(programs|program-answer|catalog|notion|notion-knowledge|hotel-availability)\.ts$/.test(n)) return "catalog";
  if (/^src\/lib\/ai\/concierge-flow\.ts$/.test(n)) return "concierge";
  if (/^src\/lib\/handoff\//.test(n)) return "handoff";
  if (/^src\/lib\/ai\/core\.ts$/.test(n)) return "core-legacy";
  return "other";
}

/** edited: array of file paths. plan: {layers, multiLayerReason}. Returns "" when fine, else the reason. */
export function checkLayerRule(edited, plan) {
  const planned = new Set(Array.isArray(plan?.layers) ? plan.layers : []);
  if (planned.size === 0) return "plan names no layer";
  if (planned.size > 1 && !String(plan.multiLayerReason ?? "").trim()) return "plan spans several layers without multiLayerReason";
  if (planned.has("core-legacy")) {
    const evidence = Array.isArray(plan?.evidence) ? plan.evidence : [];
    const legacyEvidence = evidence.some(
      (e) => typeof e?.file === "string" && layerOf(e.file) === "core-legacy"
    );
    if (!legacyEvidence) return "core-legacy requires root-cause evidence in core.ts";
  }
  const used = new Set(edited.map(layerOf).filter((l) => l !== "test"));
  const outside = [...used].filter((l) => !planned.has(l));
  if (outside.length) return `patch touches layer(s) [${outside.join(", ")}] outside the planned layer(s) [${[...planned].join(", ")}]`;
  return "";
}
