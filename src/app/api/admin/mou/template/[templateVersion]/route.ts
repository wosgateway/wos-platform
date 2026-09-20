// src/app/api/admin/mou/template/[templateVersion]/route.ts
//
// GET: lets an admin preview the MOU PDF before sending a sign
// request — same file src/lib/mou/pdf.ts later stamps a signature
// onto. Companion to the token-gated /api/mou-sign/[token]/template
// route used by the signer; this one is keyed by template_version
// directly + admin auth, since at "before send" time there's no sign
// request/token yet to resolve.
//
// ?organizationId=... makes this preview exactly what that specific
// partner would receive if sent right now — their real name +
// commercial_fee_rate filled in, generated on the fly (NOT persisted;
// the actual draft that gets saved/emailed is generated once, at
// create-sign-request time). Omit it to see the blank template as-is.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { readTemplateBytes, fillMouDraft } from '@/lib/mou/pdf';
import { resolveCommercialFeeRateForOrganization } from '@/lib/mou/commercial-terms';
import { createServiceClient } from '@/lib/supabase/service';

// fillMouDraft/readTemplateBytes touch real files/Storage — needs the
// Node.js runtime, not Edge.
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ templateVersion: string }> }
) {
  const response = NextResponse.next();
  const auth = await requireAdmin(response);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { templateVersion } = await params;
  const organizationId = req.nextUrl.searchParams.get('organizationId');

  let bytes: Buffer | Uint8Array;
  try {
    if (organizationId) {
      const supabase = createServiceClient();
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .maybeSingle();
      if (orgError || !org) {
        return NextResponse.json({ error: 'organization_not_found' }, { status: 404 });
      }
      const commercialFeeRate = await resolveCommercialFeeRateForOrganization(organizationId);
      const draft = await fillMouDraft({
        templateVersion,
        organizationName: org.name,
        commercialFeeRatePercent: commercialFeeRate,
      });
      bytes = draft.pdfBytes;
    } else {
      bytes = await readTemplateBytes(templateVersion);
    }
  } catch {
    return NextResponse.json({ error: 'template_not_found' }, { status: 404 });
  }

  const download = req.nextUrl.searchParams.get('download') === '1';
  const filename = `WOS-Founding-Partner-MOU-${templateVersion}.pdf`;

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
