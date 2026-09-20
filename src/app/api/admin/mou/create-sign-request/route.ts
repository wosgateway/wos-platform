// src/app/api/admin/mou/create-sign-request/route.ts
//
// REPLACES the previous version of this file. Behaviour is unchanged
// for every caller (PartnersManager.tsx still gets { signRequestId,
// link }, still gets 207 with a `warning` + `link` when the email
// fails) — the whole body moved into
// src/lib/mou/create-sign-request.ts so /resend can reuse it. See
// that file's header for why.
//
// Still email-only delivery: the LINE integrations in this repo
// (notify/driver-line.ts, hotel-line.ts) push to a stored
// line_user_id, which a prospective Founding Partner signing their
// first document with WOS does not have yet.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { logAdminAction } from '@/lib/admin/audit-log';
import { simpleRateLimit } from '@/lib/rate-limit';
import { createMouSignRequest } from '@/lib/mou/create-sign-request';

// fillMouDraft (pdf-lib) reads/writes real bytes — Node runtime, not Edge.
export const runtime = 'nodejs';

interface CreateSignRequestBody {
  organizationId: string;
  signerName: string;
  signerEmail: string;
  templateVersion?: string;
}

export async function POST(req: NextRequest) {
  const response = NextResponse.next();
  const auth = await requireAdmin(response);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const rl = await simpleRateLimit(`mou:create-sign-request:${auth.user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'ลองใหม่อีกครั้งในอีกสักครู่' }, { status: 429 });
  }

  let body: CreateSignRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { organizationId, signerName, signerEmail, templateVersion } = body;
  if (!organizationId || !signerName?.trim() || !signerEmail?.trim()) {
    return NextResponse.json(
      { error: 'organizationId, signerName, signerEmail are required' },
      { status: 400 }
    );
  }

  const result = await createMouSignRequest({
    organizationId,
    signerName,
    signerEmail,
    templateVersion,
    createdBy: auth.user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, detail: result.detail }, { status: result.status });
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'mou.sign_request.create',
    entityType: 'organization',
    entityId: organizationId,
    metadata: {
      signRequestId: result.signRequestId,
      signerEmail: signerEmail.trim(),
      emailSent: result.emailSent,
    },
  });

  if (!result.emailSent) {
    return NextResponse.json(
      {
        warning: 'สร้างลิงก์สำเร็จ แต่ส่งอีเมลไม่สำเร็จ — กรุณาคัดลอกลิงก์ไปส่งเอง',
        signRequestId: result.signRequestId,
        link: result.link,
        sendError: result.sendError,
      },
      { status: 207 }
    );
  }

  return NextResponse.json({ signRequestId: result.signRequestId, link: result.link });
}
