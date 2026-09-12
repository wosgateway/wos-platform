# WOS — My Journey (Phase 1)
## Sprint 1 — Final Development Brief

**Objective:** พัฒนา WOS จากระบบ Trip/Booking ให้ลูกค้าเห็นการเดินทางทั้งหมดในรูปแบบ My Journey Timeline.
WOS = คนดูแล Journey. Google Maps = เครื่องมือ Navigation.
Sprint นี้เน้น Customer UI + Partner Task View + Security verification + Mobile polish.

---

## HARD SCOPE RULE

**ใช้ของเดิม:** trips, trip_events, trip_participants, drivers, access_token, existing Trip CRUD API, existing customer trip-token resolver, existing partner authentication, existing RLS/partner-scoping model.

**ห้ามสร้าง:** new booking system, duplicate booking records, new trip architecture, new map system, GPS tracking, AI itinerary, live traffic, reminder system, separate mobile app, admin control center.

**ห้ามรื้อ schema เดิมเพียงเพื่อให้ UI ทำงาน.**

---

## EPIC A — Customer My Journey

### A1 — Trip Link Landing
Route: `/my-trip/[token]`, using existing token resolver.

| State | Message |
|---|---|
| Valid | แสดง My Journey |
| Expired | ลิงก์การเดินทางนี้หมดอายุแล้ว |
| Revoked | ลิงก์การเดินทางนี้ไม่สามารถใช้งานได้แล้ว |
| Invalid | ไม่พบข้อมูลการเดินทาง |

TH/LO/EN required. Security: never expose stack trace, DB error, internal ID, token details, or technical error text.

### A2 — Journey Timeline
Pull `trip_events` for the resolved trip only. Sort: event date → start_time → stable secondary order for ties. Render as vertical timeline; each card shows icon, date, time range, title, location, status pill.

### A3 — Event Details
Tap to expand/collapse: address, partner, contact/responsible person, notes, customer instructions — **only fields with data**. No empty "Contact:" / "Address:" / "Notes:" rows.

### A4 — Customer Status Mapping
Centralized in `lib/trips/status-labels.ts`. Internal statuses (pending_assignment, confirmed, in_progress, completed, cancelled, etc.) map to TH/LO/EN customer-facing labels. Hard rule: never send raw internal status to customer UI; never hardcode mapping per-component.

### A5 — Next Up / Current Journey (Hero Card)
- Event in progress → "NOW" card
- No event in progress → "NEXT UP" card (next upcoming)
- No events remaining → "Your Journey is Complete" / ขอบคุณที่เดินทางกับ WOS
- Must render above the fold on mobile.

### A6 — Google Maps Deep Link
No WOS map system. Build `https://www.google.com/maps/search/?api=1&query=...` per event:
- Priority 1: lat/lng if present
- Priority 2: location_name + address
- URL-encode the query every time
- No location data → no Maps button
- Must work for all three input cases: lat/lng only, address only, name+address

### A7 — Mobile First
Target 360px+, iOS + Android. Check: no horizontal scroll, tap targets ≥44px, timeline readable, hero card visible immediately, one-handed expand/collapse, Maps button easy to tap, no text overflow, long location/address strings don't break layout.

---

## EPIC B — Partner Task View

### B1 — Partner-scoped Event List
New view in existing Partner Portal, filtered to `trip_events.partner_id = logged-in partner ID`, using existing `requirePartnerAuth`.

**Hard security rule:** scope enforced at backend/RLS, never UI-filter only. Test that Partner A cannot see Partner B's events via query param manipulation, event ID manipulation, trip ID manipulation, or direct API request.

### B2 — Partner Event Status
Partner can update only their own events, only through allowed transitions (Confirmed / In Progress / Completed), reusing the existing `ALLOWED_TRANSITIONS` pattern from `/api/partner/order-items/[id]/status`. Invalid transition → 4xx, never a silent no-op, never a cross-status jump, never an update to another partner's event.

---

## EPIC C — Verify Existing Data / Security

### C1 — Schema Verification FIRST
Before writing any UI code, verify against Migration 076 + current DB schema that `trip_events` has: event_type, date, start_time, end_time, location name, address, status, partner_id, contact/responsible person, notes, customer_instructions, latitude, longitude.

Do not create a migration for fields that already exist. If something is genuinely missing, additive migration only — never restructure existing columns.

### C2 — Customer Token Security Test

| # | Test | Expected |
|---|---|---|
| 1 | Valid token | Sees only that token's trip |
| 2 | Invalid token | No data |
| 3 | Expired token | No data |
| 4 | Revoked token | No data |
| 5 | Swap trip ID / event ID | Cannot access other data |
| 6 | Direct API call (bypass UI) | Enforced same as UI |
| 7 | Customer A token vs Customer B events | No access |

Acceptance: no token substitution or ID guessing can read another trip's events.

---

## DATA FLOW

```
Customer → /my-trip/[token] → Existing Token Resolver → Trip
  → trip_events → Journey Timeline → Event Details → Google Maps
```
No parallel booking system. No duplicate trip data.

---

## UX PRINCIPLE

Customer never sees: database status, internal IDs, partner IDs, technical errors, snake_case values, unnecessary booking terminology. Friendly language only: กำลังจัดเตรียมให้คุณ / ยืนยันแล้ว / กำลังดำเนินการ / เสร็จสิ้น / ยกเลิก.

---

## DEFINITION OF DONE

**Customer**
- [ ] Trip Link opens without login
- [ ] Valid/Expired/Revoked/Invalid states all work
- [ ] Journey Timeline displays correctly
- [ ] Events sorted by date/time
- [ ] Current or Next event above the fold
- [ ] Event detail expand/collapse works
- [ ] Empty fields don't render
- [ ] Customer-friendly status only
- [ ] Location displays correctly
- [ ] Google Maps works
- [ ] Mobile 360px+, no horizontal scroll
- [ ] Tap targets ≥44px
- [ ] Tested on iOS + Android

**Partner**
- [ ] Partner sees only their own events
- [ ] Partner A cannot read Partner B's events
- [ ] Status transitions enforced
- [ ] Invalid transition returns 4xx
- [ ] Uses existing partner auth
- [ ] Uses existing RLS

**Security**
- [ ] Token substitution test passes
- [ ] ID guessing test passes
- [ ] Expired token test passes
- [ ] Revoked token test passes
- [ ] Direct API access test passes
- [ ] No cross-trip data leak

**Architecture**
- [ ] No new booking system
- [ ] No duplicate trip data
- [ ] No map system
- [ ] No unnecessary new tables
- [ ] Existing Trip architecture untouched
- [ ] Existing security model still works

---

## FUTURE — NOT IN SPRINT 1
Phase 2 (Journey Reminder) → Phase 3 (Journey Map) → Phase 4 (Journey Control Center) → Phase 5 (Smart Journey). None of these start until Sprint 1's DoD is fully checked.

---

## PRODUCT PRINCIPLE
This is not "a Trip page." It's the **WOS Digital Wellness Concierge**. Whenever a customer asks *ฉันต้องไปไหน / ไปเมื่อไหร่ / ไปอย่างไร / ใครดูแล / ต่อไปเกิดอะไรขึ้น / ถ้ามีปัญหาต้องติดต่อใคร* — the answer should live in My Journey.
