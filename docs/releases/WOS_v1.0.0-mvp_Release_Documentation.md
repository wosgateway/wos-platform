# WOS Platform €” Release Documentation

**Version:** v1.0.0-mvp  
**Release Date:** 2026-08-07  
**Release Tag:** `v1.0.0-mvp`  
**Production Commit:** `12b907ba07527bba459e3844a667370442e65f4c`  
**Branch:** `main`

---

# Release Summary

WOS v1.0.0-mvp is the first production-ready MVP release of the WOS Platform.

This release establishes the core cross-border healthcare booking and partner operation workflow between Thailand and Laos, including booking, quotation, payment deposit handling, partner assignment, and multilingual partner portal infrastructure.

---

# Goals Achieved

- Production-ready Next.js platform
- Multilingual architecture (TH / LO / EN)
- Partner Portal foundation
- Admin Portal foundation
- Booking Engine
- Order Management
- Quotation Workflow
- Payment Deposit Engine
- Partner Assignment Workflow
- Stable production build
- Git release workflow (feature †’ develop †’ main)

---

# Major Features

## Customer Experience

### Homepage
- Hero Slider
- Trust Bar
- How It Works section
- Become Partner section
- Improved brand positioning

### Package Discovery
- Category pages
- Program pages
- Package booking entry

### Booking Flow
- Booking form
- Date selection
- Time selection
- Customer information
- Program/package selection

---

## Quotation System

New quotation workflow includes:

- Generate quotation
- View quotation by order number
- Customer quotation confirmation route
- Admin quotation sending API

Routes:

- `/[locale]/quote`
- `/[locale]/quote/[orderNumber]`
- `/api/admin/send-quotation`
- `/api/quote/[orderNumber]`

---

## Admin Portal

Implemented:

- Admin dashboard
- Orders list
- Order detail page
- Pending partner assignments
- Package picker API
- Order assignment API
- Order management API

Key routes:

- `/admin`
- `/admin/orders`
- `/admin/orders/[orderId]`
- `/admin/pending-assignments`

---

## Partner Portal

Locale-based partner portal implemented:

- Dashboard
- Packages
- Bookings
- Company
- Analytics
- Billing
- Documents

Structure:

- `/[locale]/dashboard`
- `/[locale]/packages`
- `/[locale]/bookings`
- `/[locale]/company`
- `/[locale]/analytics`

---

# Payment Engine

Implemented:

- Deposit payment workflow
- Payment verification endpoint
- Payment rejection endpoint
- Payment-related database migrations

APIs:

- `/api/partner/payments/[id]/verify`
- `/api/partner/payments/[id]/reject`

---

# Database Migrations Included

Included migrations:

- `000b_check_real_state.sql`
- `002_check_order_function.sql`
- `007_consolidate_group_b_rls_and_fk_fixes.sql`
- `008_booking_payment_engine.sql`
- `008_restrict_cases_rls.sql`
- `009_fix_payments_partner_rls.sql`
- `010_link_partners_to_payment_engine.sql`
- `011_create_customers_table.sql`
- `012_create_order_with_items_function.sql`
- `013_add_booking_details_and_pending_items.sql`
- `014_update_create_order_with_items_for_bookingform.sql`
- `015_fix_balance_remaining_nullable.sql`
- `016_admin_assign_order_item.sql`

---

# Architecture Changes

## Locale Routing Refactor

Partner portal moved under locale routing:

From:

- `/dashboard`
- `/packages`
- `/bookings`

To:

- `/[locale]/dashboard`
- `/[locale]/packages`
- `/[locale]/bookings`

This establishes full multilingual platform architecture.

---

# API Surface Added

## Orders

- `POST /api/orders`

## Admin

- `GET /api/admin/orders`
- `GET /api/admin/orders/[id]`
- `GET /api/admin/order-items/pending`
- `POST /api/admin/order-items/[id]/assign`
- `GET /api/admin/packages/pickers`
- `POST /api/admin/send-quotation`

## Quote

- `GET /api/quote/[orderNumber]`
- `POST /api/quote/[orderNumber]/confirm`

## Partner Payments

- `POST /api/partner/payments/[id]/verify`
- `POST /api/partner/payments/[id]/reject`

---

# Build Verification

Production build status:

- Compiled successfully
- Type checking passed
- Lint passed
- Static pages generated: **45**
- Sitemap generation passed
- Middleware compiled successfully

---

# Release Workflow Completed

```
feature/payment-engine
        †“
merge
        †“
develop
        †“
cleanup
        †“
main
        †“
tag v1.0.0-mvp
```

Final release commit:

`12b907ba07527bba459e3844a667370442e65f4c`

---

# Repository Cleanup Performed

Removed before production:

- `src/middleware.ts.debug-backup`
- `sql/desktop.ini`
- accidental empty files:
  - `admin`
  - `dir`
  - `rmdir`

---

# Known Limitations (Deferred to Phase 2)

Not included in v1.0.0-mvp:

- Partner Account Linking
- Staff Invitation
- Role Management
- Branch Management
- Multi-Partner Organization
- Enterprise Permission Matrix
- Advanced CRM Automation
- Financial settlement automation
- Hotel / transport settlement engine

---

# Business Flow Covered by MVP

```
Customer
    †“
Package / Program
    †“
Booking
    †“
Order
    †“
Quotation
    †“
Deposit Payment
    †“
Partner Assignment
    †“
Service Delivery
```

This represents the first complete operational loop of the WOS Platform.

---

# Next Milestone

## Phase 1.1 €” Market Validation

Objectives:

- Onboard first 3€“5 real partners
- Publish 10€“20 real healthcare programs
- Process first live bookings
- Validate quotation conversion
- Validate payment deposit workflow
- Collect operational feedback from partner clinics and hospitals

Success metric:

**Real completed cross-border booking through the WOS platform.**

---

# Release Approval

**Release Name:** WOS Platform v1.0.0 MVP  
**Approved Branch:** `main`  
**Release Tag:** `v1.0.0-mvp`  
**Status:** œ… Released
