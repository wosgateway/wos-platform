// src/lib/security/safe-url-fetch.ts
//
// SSRF-safe fetcher, built specifically for the location-resolver admin
// endpoint (resolve-location route). It follows a Google Maps URL
// server-side and must never be tricked into hitting an internal
// service or the cloud metadata endpoint.
//
// Mitigations:
//   1. Hostname allowlist — only ever fetch a small set of Google-owned
//      hosts. This also closes off DNS-rebinding as a practical concern:
//      rebinding requires the attacker to control DNS answers for an
//      allowlisted hostname, and arbitrary hostnames are never allowed
//      in the first place.
//   2. Before every hop, DNS is resolved here (not left to the
//      underlying fetch) and rejected if ANY returned address is
//      private / loopback / link-local / otherwise reserved — IPv4
//      and IPv6 both, including IPv4-mapped IPv6 (::ffff:a.b.c.d).
//   3. Manual redirect handling (`redirect: 'manual'`) — every hop is
//      re-validated (host allowlist + DNS), not just the first
//      request. Capped at MAX_REDIRECTS hops.
//   4. Per-request timeout via AbortController.
//
// This module intentionally has no knowledge of partners/lat-lng
// parsing — it only fetches safely. See resolve-location/route.ts for
// how the result is used.

import { promises as dns } from 'dns';
import { isIPv4, isIPv6 } from 'net';

const ALLOWED_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.app.goo.gl',
]);

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 8000;

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
}

// Loopback, RFC1918 private ranges, link-local (covers the
// 169.254.169.254 cloud metadata address), plus a handful of other
// reserved/special-use ranges blocked as defense in depth.
const BLOCKED_IPV4_CIDRS = [
  '127.0.0.0/8', // loopback
  '10.0.0.0/8', // private
  '172.16.0.0/12', // private
  '192.168.0.0/16', // private
  '169.254.0.0/16', // link-local / cloud metadata
  '0.0.0.0/8', // "this" network
  '100.64.0.0/10', // carrier-grade NAT
  '192.0.0.0/24', // IETF protocol assignments
  '198.18.0.0/15', // benchmarking
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved
];

function isBlockedIPv4(ip: string): boolean {
  return BLOCKED_IPV4_CIDRS.some((cidr) => ipv4InCidr(ip, cidr));
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  if (lower === '::1') return true; // loopback

  // IPv4-mapped (::ffff:a.b.c.d) — unwrap and check the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);

  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10 link-local

  return false;
}

function isBlockedIP(ip: string): boolean {
  if (isIPv4(ip)) return isBlockedIPv4(ip);
  if (isIPv6(ip)) return isBlockedIPv6(ip);
  return true; // unrecognized format — fail closed
}

async function assertHostResolvesSafely(hostname: string): Promise<void> {
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SafeFetchError(`DNS resolution failed for ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new SafeFetchError(`DNS resolution returned no addresses for ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isBlockedIP(address)) {
      throw new SafeFetchError(
        `${hostname} resolved to a blocked/private address (${address}) — refusing to fetch`
      );
    }
  }
}

function assertHostAllowlisted(hostname: string): void {
  if (!ALLOWED_HOSTS.has(hostname.toLowerCase())) {
    throw new SafeFetchError(`Host "${hostname}" is not on the allowlist`);
  }
}

/**
 * Fetches `initialUrl`, following redirects manually and re-validating
 * hostname + DNS at every hop. Refuses to leave the Google Maps host
 * allowlist or touch a private/internal address at any point.
 *
 * Throws SafeFetchError on any policy violation — callers must turn
 * that into a clear error response, never a silent fallback.
 */
export async function safeUrlFetch(initialUrl: string): Promise<Response> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(initialUrl);
  } catch {
    throw new SafeFetchError('Invalid URL');
  }

  let redirectCount = 0;

  while (true) {
    if (currentUrl.protocol !== 'https:') {
      throw new SafeFetchError(`Refusing non-https URL: ${currentUrl.protocol}`);
    }

    assertHostAllowlisted(currentUrl.hostname);
    await assertHostResolvesSafely(currentUrl.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(currentUrl.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'VITH-HUB-LocationResolver/1.0' },
      });
    } catch (err) {
      throw new SafeFetchError(
        `Fetch failed for ${currentUrl.hostname}: ${err instanceof Error ? err.message : 'unknown error'}`
      );
    } finally {
      clearTimeout(timeout);
    }

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect) {
      return response;
    }

    redirectCount += 1;
    if (redirectCount > MAX_REDIRECTS) {
      throw new SafeFetchError(`Too many redirects (>${MAX_REDIRECTS}) resolving ${initialUrl}`);
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new SafeFetchError(`Redirect response (${response.status}) had no Location header`);
    }

    // Location may be relative — resolve against the current URL.
    currentUrl = new URL(location, currentUrl);
  }
}
