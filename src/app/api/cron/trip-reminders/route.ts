import { NextRequest, NextResponse } from 'next/server';
import { runReminderSweep } from '@/lib/trips/reminders/engine';

// GET /api/cron/trip-reminders
//
// Brief §16 (Execution Model): "ต้องมี scheduled execution mechanism...
// ห้ามสร้าง server ที่ต้องเปิดค้างเองเพียงเพื่อ Reminder." This route is
// the whole mechanism — it does one sweep and returns; nothing here
// stays running between invocations.
//
// SCHEDULING — READ BEFORE DEPLOYING:
// vercel.json in this patch schedules this route every 10 minutes via
// Vercel Cron. IMPORTANT: Vercel's Hobby plan only allows cron jobs to
// fire once per day, which is nowhere near frequent enough for the R2
// "1 hour before" window (brief §20 Test 5 requires catching that
// window within ~15 minutes). If the project is on Hobby, either
// upgrade to Pro, or point an external scheduler (GitHub Actions
// on a schedule, cron-job.org, etc.) at this same URL with the same
// CRON_SECRET bearer header — the route doesn't care who calls it.
//
// AUTH: requires `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron
// sends this automatically when CRON_SECRET is set as a project env
// var; an external scheduler must be configured to send the same
// header. No secret configured -> route refuses all requests (fails
// closed, not open).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 });
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await runReminderSweep();

  return NextResponse.json({ ok: true, ...result });
}
