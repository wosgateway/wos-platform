import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.LITELLM_BASE_URL;

  if (!url) {
    return NextResponse.json(
      { ok: false, error: 'LITELLM_BASE_URL is not set' },
      { status: 500 }
    );
  }

  const started = Date.now();

  try {
    const response = await fetch(`${url}/v1/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.LITELLM_API_KEY || ''}`,
      },
      cache: 'no-store',
    });

    const text = await response.text();

    return NextResponse.json({
      ok: response.ok,
      upstreamStatus: response.status,
      elapsedMs: Date.now() - started,
      headers: {
        server: response.headers.get('server'),
        cfRay: response.headers.get('cf-ray'),
        cfCacheStatus: response.headers.get('cf-cache-status'),
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
        via: response.headers.get('via'),
      },
      bodyPreview: text.slice(0, 300),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        elapsedMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
      },
      { status: 502 }
    );
  }
}
