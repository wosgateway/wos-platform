WOS AI CORE CONTRACT (the agent must respect this; it is not negotiable)

Layers (one responsibility each):
- understanding: src/lib/ai/understanding/{understand,llm,types,provinces}.ts - turns text into intent + entities
- gate: understanding/gate.ts - decides whether the new path or legacy answers
- orchestrator: understanding/orchestrator.ts - pure business rules: Understanding + context -> Action
- state: understanding/state.ts, journey-state.ts - remembers conversation state
- catalog: programs.ts, program-answer.ts, catalog.ts, notion*.ts - dynamic facts and knowledge
- concierge / handoff: concierge-flow.ts, src/lib/handoff - booking journey and human handoff
- core-legacy: core.ts - old path; touch it only when the bug is proven to be there

Rules:
- LLM = understands the message. Business rules = decide. State = remembers. Supabase = dynamic facts. Notion = knowledge. Tests = contract.
- Find the ROOT CAUSE and the layer that owns it before any edit. Fix it in that layer only.
- Never add keyword/regex patches that hard-code the customer sentence from a test just to make it pass.
- Never edit existing tests. A new reproducing test may be added.
- Do not change a business rule because the LLM answered wrong: check understanding and state first.
- Touching more than one layer needs an explicit reason (multiLayerReason).
- If unsure, stop and report the blocker instead of guessing.
