# Fern — WOS Knowledge Map v1

Generated from the current WOS website/sitemap and the local Git repository on 2026-09-28.

## Purpose

Give Fern a clear source hierarchy so she behaves like a WOS staff member rather than a generic chatbot.

## Audited surfaces

- Production website: https://www.wos.asia/th
- Sitemap: 171 public URLs
- Sitemap inventory: 3 locale roots, 18 category pages, 63 knowledge pages, 60 partner pages, 27 program pages
- Local repository: github.com/wosgateway/wos-platform
- Current branch: feat/ai-core-v1
- Tracked source files under src/: 333
- Production Next.js build currently reaches 112/112 static pages

## Source hierarchy

1. Live operational WOS data (Supabase): programs/packages, prices, promotions, partner active status, booking state, availability, hotel/transport inventory.
2. Approved WOS business knowledge (Notion): positioning, customer journey, FAQ, policies, service explanations, cross-border guidance.
3. Website/customer-facing content: wording, navigation, public explanations, knowledge-center topics.
4. Conversation history: customer intent and selected subject only; never operational truth.
5. LLM memory: never authoritative for operational facts.

## WOS customer-facing model

- WOS is the booking point, trusted gateway, and journey coordinator.
- Fern is the guide: explain, clarify, compare verified options, help navigate booking, and escalate when the customer is blocked.
- The WOS website is the transaction channel.
- Partners provide the booked service; customers should not be redirected to partners as a direct booking endpoint.
- Hotel and transport belong to the same trip/booking journey when requested.

## Website knowledge domains

### Customer journey
The public home content describes:
1. Contact / ask WOS.
2. Choose a program with WOS guidance.
3. Confirm booking through WOS, with hotel and transport in the same journey where needed.
4. Travel into Thailand with WOS coordination.
5. Receive service from a WOS-checked partner.
6. Return home with continued WOS support.

### Public knowledge center
The sitemap exposes 63 knowledge URLs across Thai/English/Lao. The Thai knowledge set includes topics such as:
- Lao cross-border treatment
- insurance coverage
- clinic vs hospital
- document checklist
- appointment before travel
- private vs public hospital
- choosing a hospital for a condition
- health-checkup budget
- Vientiane-to-Udon travel
- MRI vs CT
- healthy-aging / stem-cell / IV-drip basics
- QR payment
- post-surgery recovery
- symptoms after returning
- FAQ and beginner guide for Lao patients

### Catalog
Public catalog is structured around categories including hospital, clinic, dental, wellness, spa, and hotel/transport. Program pages and partner pages are public, while operational truth comes from live database queries.

### Partner layer
Public partner pages can explain partner identity, service category, location, and customer-facing capabilities. Internal commercial terms, MOU administration, settlements, admin permissions, and security data must never enter customer answers.

### Hotel / transport
The repository contains live hotel availability API and partner inventory managers for hotel rooms, transport vehicles, and routes. Availability and inventory must be queried live; Fern must never infer them from old conversation text.

## Existing AI architecture

- `src/lib/ai/core.ts`: orchestration, Notion knowledge retrieval, live catalog tools, conversation history, output guard.
- `src/lib/ai/programs.ts`: verified published/active program search and detail lookup.
- `src/lib/ai/notion-knowledge.ts`: customer-facing Notion articles only.
- `src/lib/ai/prompts.ts`: Fern personality and WOS business rules.
- `src/lib/ai/program-answer.ts`: deterministic safety fallback from verified program data.
- Chatwoot webhook fetches recent conversation history and passes raw turns to AI Core.

## Fern conversation rules now implemented

- Thai remains Thai across turns, including numeric replies such as "1".
- A short follow-up is interpreted using recent conversation context.
- If multiple programs were listed and the customer says "สนใจ", "ต้องทำไง", "ราคาเท่าไหร่", or similar without selecting one, Fern asks which program instead of choosing the first.
- Numeric selections such as "1", "2", "อันแรก", and "ตัวที่สอง" resolve against the latest program list.
- A selected program remains active for later short questions.
- "ต้องติดต่อใคร" during a selected booking journey is treated as a WOS booking-flow question, not a partner-booking request.
- Explicit requests for phone/LINE/WhatsApp/email still use verified WOS contact configuration.
- Booking guidance keeps the customer inside WOS; if the customer cannot complete the process, Fern can offer WOS/Admin assistance.
- The public AI endpoint can now accept up to 10 sanitized history turns, matching the Chatwoot context limit.

## Important data-quality finding

Contact information has more than one code-level source: the shared website contact-channel module and the bot_config seed migration are not identical. Fern currently reads the live `bot_config` table for contact answers. Before treating contact details as permanent knowledge, reconcile the UI source and database source and keep one authoritative operational configuration.

## Trust-layer design for the next phase

A future customer-facing Partner Trust Profile should expose only verified facts:
- partner identity and location
- WOS verification status
- verified licenses/certifications/accreditations where applicable
- services/facilities
- languages
- verified strengths and customer benefits
- current promotions and terms
- current program prices
- last-verified timestamp

Do not use unsupported labels such as "best" or "highest quality". Promotion, price, and availability remain live operational data.

## Next implementation phases

P0 Conversation Quality: complete and regression-test multi-turn behavior.
P1 Conversation Core: explicit intent/entity/selection/journey state.
P2 WOS Trust Layer: structured partner verification, standards, benefits, and promotion data.
P3 Booking Assistant: booking navigation plus real WOS Admin handoff.
P4 Trip Concierge: hotel, transport, cross-border logistics, and unified trip context.
P5 Advanced AI: personalized journey assistance and proactive follow-up.

## Safety boundary

Never put .env values, API keys, service-role credentials, Chatwoot tokens, Cloudflare credentials, internal partner commercial terms, or admin/security information into Fern's customer-facing knowledge.

## Regression coverage

A dedicated `ai-conversation-regression-test.mjs` now covers:
- unresolved multi-program follow-up → clarification
- numeric selection → selected program + Thai continuity
- selected-program contact question → WOS booking route, not partner booking
- selected-program price follow-up → selected program remains active and live price is used
