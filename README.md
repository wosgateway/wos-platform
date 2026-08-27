# WOS Platform

WOS — Wellness Operating System

## Tech Stack
- Next.js 14
- TypeScript
- Supabase
- Tailwind CSS
- next-intl

## Development

npm install
npm run dev

## Environment

Create `.env.local`:

NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

## Main Areas

/              Public website
/[locale]      Thai / Lao / English
/partner       Partner portal
/admin         WOS admin
/my-trip       Customer journey

## System

- Partner management
- Company profile
- Booking
- Payment
- Partner portal
- Customer journey
- WOS Journey Control Center
- Supabase RLS
- Private storage / signed URLs

## Security

- Supabase Auth
- RLS
- Private booking attachments
- Signed URLs
- Server-side service role operations

## Development Status

Production development in progress.

## Build

npm run build