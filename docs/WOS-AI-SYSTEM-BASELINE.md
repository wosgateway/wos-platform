# WOS AI System Baseline

Baseline: 2026-10-08
Branch: feat/ai-core-v1
Production: www.wos.asia

## Purpose

Single Source of Truth for WOS AI / Fern. Read this before changing AI behavior to avoid regression, duplicate fixes, and contradictory business logic.

## Architecture

Customer channels  Chatwoot  /api/chatwoot/webhook  WOS AI Core  Understanding Layer  deterministic business rules  Supabase/Notion  Journey State  Concierge Handoff.

### Understanding Layer

The LLM is used only for language understanding.

LLM output:
- intent
- confidence
- province
- program query
- selection index
- detail field
- context usage
- language

The LLM does NOT:
- answer customers directly
- invent prices
- invent availability
- select a program without evidence
- decide business rules
- perform bookings
- claim successful actions

The orchestrator validates the understanding result and applies deterministic WOS rules before accessing verified catalog data.

## Source of Truth

Notion:
- FAQ
- WOS knowledge
- partner/destination/cross-border knowledge

Supabase:
- programs/packages
- prices
- publication/active status
- availability
- booking/journey operational data
- AI conversation state
- AI observability requests

Catalog truth remains packages JOIN partners with published/active filtering.

## Fern Role

Warm, concise intake/concierge assistant.

Fern should:
1. Understand what the customer wants.
2. Show verified options.
3. Collect only the minimum next-step information.
4. Confirm known information.
5. Hand off to WOS staff when operational coordination is required.

Thai-first with Lao and English support.

## Current Customer Flow

1. Reset/new journey
2. Program discovery
3. Show title + price first
4. Customer explicitly selects a program
5. Collect name
6. Ask transport yes/no; if yes collect pickup point
7. Ask hotel yes/no
8. Accept hotel need and hand off
9. WOS/admin collects detailed logistics

Do not routinely ask budget when catalog prices are already shown.

Transport:
- Ask only whether transport is needed.
- If yes, collect pickup point.
- WOS can arrange pickup anywhere in Laos.
- Do not prematurely ask date, time, passenger count, destination, or budget.

Hotel:
- Ask only whether hotel is needed.
- Detailed room/type/rate logistics belong to WOS/admin.

Drop-off:
- Fern should not routinely ask for drop-off.
- Destination can be derived from the selected program or coordinated later.

## Conversation Boundaries

- Bare สนใจ / ສນໃຈ without selected program  catalog discovery, never name collection.
- "สนใจโปรแกรมในอดร"  discovery, never auto-select the first program.
- "ขอดโปรแกรมในอดร"  discovery.
- Generic "สนใจโปรแกรม"  ask for province / available province options.
- Explicit numbered or named selection  selection.
- Greetings/small talk  normal conversation, never forced catalog search.
- Province clarification overrides stale selected-program context.
- Reset clears stale journey interpretation.
- Latest customer message must take priority over stale previous intent.
- Do not repeat information already known.
- "ขอบคณครบ/คะ/ขอบคณมาก" after a completed action must not restart or repeat the previous hotel/booking action.

## Understanding Gate

Environment:
- WOS_AI_UNDERSTANDING=off|shadow|on
- Default: off

Modes:
- off: legacy behavior remains authoritative.
- shadow: understanding runs for evaluation/observability but does not take control.
- on: validated understanding + deterministic orchestrator may handle supported catalog intents.

Supported Understanding intents:
- PROGRAM_DISCOVERY
- PROGRAM_SEARCH
- PROGRAM_MORE
- PROGRAM_SELECTION
- PROGRAM_DETAIL
- HOTEL
- TRANSPORT
- HANDOFF
- RESET
- GENERAL_QUESTION
- SMALLTALK
- UNKNOWN

Low-confidence or invalid understanding must defer to legacy behavior.

## Province Model

Canonical provinces are stored in public.provinces.

The migration seeds 77 Thai provinces and aliases.

Province detection must:
- normalize known aliases
- support Thai/Lao/English forms where configured
- never infer a province merely because it appeared in an earlier unrelated message
- use conversation context only where the deterministic rules explicitly allow it

## Conversation State

public.ai_conversation_state stores:
- conversation id
- channel
- province
- last trusted catalog
- catalog query
- catalog offset
- selected program
- timestamps

Catalog context is trusted only when it can be matched against conversation history.

## AI Observability

public.ai_requests records:
- conversation
- mode
- message hash
- optional message text
- language
- intent
- confidence
- entities
- action
- defer reason
- handled status
- latency
- errors

Customer message text is logged only when AI_LOG_TEXT=true.

Retention target is approximately 90 days.

## Chatwoot Webhook

Official Chatwoot signature validation uses timestamp + raw-body HMAC-SHA256.

Webhook route:
src/app/api/chatwoot/webhook/route.ts

The webhook passes conversationId/channel context into the WOS AI Core so conversation state can be persisted by the Understanding layer.

## Handoff

src/lib/handoff/concierge.ts creates concise Thai/Lao/English summaries.

Hotel affirmative after Fern's hotel question can immediately hand off.

Hotel information questions remain normal questions and must not be mistaken for a booking confirmation.

## Current Verification

As of 2026-10-08:

### TypeScript
PASS

### Vitest
49/49 tests passed:
- Understanding: 22
- Concierge: 15
- Handoff service: 12

### Production Build
PASS
- Next.js 14.2.35
- 113/113 static pages generated

### AI Regression
21/21 hard checks passed
0 execution failures
1 human review item

The review item is T4 generic/small-talk behavior and returned a normal Fern greeting.

Regression coverage includes:
- catalog discovery
- semantic/symptom search
- province scope
- explicit program selection
- reset
- transport
- escalation
- Lao interest
- hotel availability
- hotel oversell protection
- hotel handoff
- program discovery phrase protection
- generic program discovery
- catalog follow-up
- small talk

## Understanding Evaluation

eval/ contains 46 cases.

Current baseline is intentionally NOT locked.

eval/baseline.json remains at pass_rate 0 until the real configured LLM is evaluated and the achieved rate is reviewed.

Do not run --lock automatically.

Hallucination cases must all pass before locking the evaluation baseline.

## Database Migration

Local migration:

supabase/migrations/20261008120000_ai_understanding_layer.sql

The migration:
- creates provinces
- creates ai_conversation_state
- creates ai_requests
- adds indexes/RLS
- seeds 77 Thai provinces and aliases

The migration has NOT been applied to the production Supabase database yet.

Never apply the migration as part of a normal code commit.

## Production Status

The current Understanding-layer changes are NOT committed, pushed, or deployed.

Production remains on the existing canonical production image.

Do not claim the current Understanding layer is live until:
1. code is committed
2. branch is pushed
3. deployment is explicitly approved
4. production verification passes

Historical production commits may be referenced as history only and must not be described as the current Understanding-layer deployment.

## Operational Discipline

Never use:

git add .

Stage only explicitly reviewed files.

Before commit:
1. targeted tests
2. full regression
3. build
4. diff review
5. git diff --check
6. staged diff review
7. explicit user approval

Before deployment:
1. commit/push completed
2. production build verified
3. regression verified
4. explicit deployment approval

Commit/push/deploy always require explicit approval.

## Roadmap

Current work:
- AI Core/personality: completed
- Journey Concierge v1: completed
- Handoff: completed
- Thai/Lao handling: completed
- Regression protection: completed
- Understanding layer: implemented locally and under verification

Next:
1. Lock Understanding evaluation baseline after real LLM evaluation
2. Review/enable Understanding mode deliberately
3. WOS AI Dev Agent
4. Hotel Booking/Availability Integration

## Change Discipline

Read this baseline before changing AI behavior.

Identify the source-of-truth layer first.

Do not add duplicate guards across multiple layers unless there is a documented boundary reason.

Run targeted tests, full regression, build, inspect the diff, stage exact files, and obtain explicit approval before commit/push/deploy.

Golden rule:

Do not fix the same symptom in multiple layers. Find the source of truth first.
