import { createServiceClient } from "@/lib/supabase/service";
import crypto from "crypto";

/**
 * Resolves a trip access token to a trip row, enforcing the rule the
 * schema documents on trips.access_token but does NOT enforce itself:
 *
 *   1. token exists
 *   2. token_revoked_at is null
 *   3. token_expires_at is null OR in the future
 *   4. ONLY THEN is the trip returned / used to scope further queries
 *
 * Looks up by access_token_hash (migration 079, a stored generated
 * SHA-256 column with its own unique index) instead of scanning
 * access_token directly — an O(1) indexed match rather than fetching
 * every trip row and comparing in a loop. Hashing first is what keeps
 * this safe: unlike comparing the raw token, timing differences between
 * SHA-256 digests reveal nothing about the token's actual characters
 * (avalanche effect), so an indexed equality match on the hash doesn't
 * reopen the timing leak this function exists to avoid. The final
 * timingSafeEqual() below is defense-in-depth against a hash collision —
 * it runs against the single row the index returned, not the whole
 * table, so it stays O(1) as trips grows.
 *
 * Never log `token` (raw value). Never return it in any response body
 * beyond the initial issuance. Never pass it into analytics events.
 */
export async function resolveTripByToken(token: string) {
  if (!token || typeof token !== "string") {
    return { trip: null, error: "invalid_token" as const };
  }

  const supabase = createServiceClient();

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const { data: match, error } = await supabase
    .from("trips")
    .select("id, access_token, token_revoked_at, token_expires_at")
    .eq("access_token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    return { trip: null, error: "lookup_failed" as const };
  }

  if (!match) {
    return { trip: null, error: "not_found" as const };
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
    return { trip: null, error: "not_found" as const };
  }

  if (match.token_revoked_at) {
    return { trip: null, error: "revoked" as const };
  }

  if (match.token_expires_at && new Date(match.token_expires_at) < new Date()) {
    return { trip: null, error: "expired" as const };
  }

  // Now fetch the full trip row, scoped strictly to this id — every
  // downstream query in the route handler must also filter by this
  // exact trip.id, never by token again.
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("*")
    .eq("id", match.id)
    .single();

  if (tripError || !trip) {
    return { trip: null, error: "not_found" as const };
  }

  return { trip, error: null };
}
