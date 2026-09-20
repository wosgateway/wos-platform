// src/app/api/mou-sign/[token]/route.ts
//
// GET: resolves a sign-link token and returns the minimal info the
// signing page needs to render (org name, masked signer email/phone so
// the signer can confirm "yes this is me" without the page leaking the
// full value to anyone who has the link but isn't the intended signer).

import { NextRequest, NextResponse } from 'next/server';
import { resolveSignToken } from '@/lib/mou/tokens';

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.replace(/\d(?=\d{2})/g, '*');
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { request: signRequest, error } = await resolveSignToken(token);

  if (error || !signRequest) {
    const status = error === 'lookup_failed' ? 500 : 404;
    return NextResponse.json({ error: error ?? 'not_found' }, { status });
  }

  return NextResponse.json({
    organizationName: signRequest.organizationName,
    templateVersion: signRequest.templateVersion,
    signerName: signRequest.signerName,
    signerEmailMasked: maskEmail(signRequest.signerEmail),
    signerPhoneMasked: maskPhone(signRequest.signerPhone),
    hasEmail: Boolean(signRequest.signerEmail),
    hasPhone: Boolean(signRequest.signerPhone),
  });
}
