import { createServiceClient } from "@/lib/supabase/service";
import crypto from "crypto";

/**
 * Resolves a partner-scoped trip link token (088_trip_partner_links.sql)
 * to a (trip_id, partner_id) pair, enforcing the same sequence
 * resolveTripByToken() enforces for the customer-facing token:
 *
 *   1. token exists
 *   2. token_revoked_at is null
 *   3. token_expires_at is null OR in the future
 *   4. ONLY THEN is (trip_id, partner_id) returned / used to scope
 *      further queries
 *
 * This is deliberately a SEPARATE function from resolveTripByToken(),
 * not an extra parameter on it — the two tokens live in different
 * tables (trips.access_token vs trip_partner_links.access_token) and
 * grant different scopes (whole trip vs one partner's slice of it).
 * Keeping them as separate functions means a future edit to one
 * resolution path can't accidentally widen the other's scope.
 *
 * Callers MUST filter every downstream trip_events query by BOTH
 * trip_id AND partner_id from the returned row — trip_id alone
 * reopens the cross-partner leak this table exists to close.
 *
 * Never log `token` (raw value). Never return it in any response body
 * beyond the initial issuance. Never pass it into analytics events.
 */
export async function resolvePartnerTripToken(token: string) {
  if (!token || typeof token !== "string") {
    return { link: null, error: "invalid_token" as const };
  }

  const supabase = createServiceClient();

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const { data: match, error } = await supabase
    .from("trip_partner_links")
    .select("id, trip_id, partner_id, access_token, token_revoked_at, token_expires_at")
    .eq("access_token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    return { link: null, error: "lookup_failed" as const };
  }

  if (!match) {
    return { link: null, error: "not_found" as const };
  }

  // Defense-in-depth: confirm the actual token matches, not just its
  // hash, before trusting this row. Constant-time against exactly one
  // candidate, so it costs nothing extra at scale.
  const tokenBuf = Buffer.from(token);
  const rowBuf = Buffer.from(match.access_token ?? "");
  const tokensMatch =
    rowBuf.length === tokenBuf.length &&
    (() => {
      try {
        return crypto.timingSafeEqual(tokenBuf, rowBuf);
      } catch {
        return false;
      }
    })();

  if (!tokensMatch) {
    return { link: null, error: "not_found" as const };
  }

  if (match.token_revoked_at) {
    return { link: null, error: "revoked" as const };
  }

  if (match.token_expires_at && new Date(match.token_expires_at) < new Date()) {
    return { link: null, error: "expired" as const };
  }

  return {
    link: { tripId: match.trip_id as string, partnerId: match.partner_id as string },
    error: null,
  };
}
