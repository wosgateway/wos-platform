// src/app/api/mou-sign/[token]/template/route.ts
//
// GET: serves the raw, unstamped MOU template PDF for a sign request,
// gated by the same token as the rest of /api/mou-sign/[token]/* —
// same trust model as that route (link IS the access control). This is
// the "let the signer actually see the document before they sign it"
// gap: previously the sign page only showed a text notice, with no way
// to open the real PDF.
//
// Deliberately does NOT require the OTP to have been verified yet —
// reading the draft is exactly what a signer needs to decide whether
// to request the OTP in the first place, and it's the same file
// everyone with the link would eventually see anyway.
//
// ?download=1 sends Content-Disposition: attachment instead of inline,
// for the "ดาวน์โหลด" affordance vs. "ดู" (opens in a new tab / the
// browser's built-in PDF viewer).

import { NextRequest, NextResponse } from 'next/server';
import { resolveSignToken } from '@/lib/mou/tokens';
import { loadMouBaseDocument } from '@/lib/mou/pdf';

// loadMouBaseDocument can download from Supabase Storage — needs the
// Node.js runtime, not Edge.
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { request: signRequest, error } = await resolveSignToken(token);

  if (error || !signRequest) {
    const status = error === 'lookup_failed' ? 500 : 404;
    return NextResponse.json({ error: error ?? 'not_found' }, { status });
  }

  let bytes: Buffer;
  try {
    // This partner's actual generated draft (name + rate filled in)
    // if one exists, else the blank template for legacy requests —
    // same resolution the final signature-stamping step uses, so
    // what the signer previews here is guaranteed to be what they end
    // up signing.
    bytes = await loadMouBaseDocument({
      templateVersion: signRequest.templateVersion,
      draftStoragePath: signRequest.draftStoragePath,
    });
  } catch {
    // Template/draft not available (see pdf.ts's header) — surface
    // this distinctly from "link invalid" so an admin troubleshooting
    // a signer's report knows exactly what's missing.
    return NextResponse.json({ error: 'template_not_found' }, { status: 404 });
  }

  const download = req.nextUrl.searchParams.get('download') === '1';
  const filename = `WOS-Founding-Partner-MOU-${signRequest.templateVersion}.pdf`;

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
