// src/lib/storage/signed-attachment-url.ts
//
// Companion to signed-slip-url.ts  same private-bucket migration
// (044 here, 033 there), same dual-shape problem. New rows store the
// bare object path directly, as uploaded by BookingForm.tsx /
// JourneyBookingForm.tsx (e.g. "<uuid>-<filename>"). Older rows
// created before this fix may still hold the full dead public URL
// (from the getPublicUrl() call JourneyBookingForm.tsx used to make),
// so this resolves either shape into a signed URL  same
// extractObjectPath() approach as signed-slip-url.ts, not a hard
// rejection of anything URL-shaped, so existing orders don't lose
// their attachment on read. Called server-side from authenticated
// admin/partner routes only  never from a public endpoint.
//
// These are customer-uploaded medical documents/test results
// ("อปโหลดเอกสาร/ผลตรวจ" in BookingForm.tsx), so treat this at least
// as carefully as payment slips.

import { createServiceClient } from '@/lib/supabase/service';

const PATH_MARKER = '/storage/v1/object/public/booking-attachments/';

// Same TTL as signed-slip-url.ts  long enough for an admin to open
// it after loading the order page, short enough that a copied/leaked
// link stops working quickly.
const SIGNED_URL_TTL_SECONDS = 600;

function extractObjectPath(stored: string): string | null {
  // New rows: stored value is already the bare object path.
  if (!stored.includes(PATH_MARKER)) return stored || null;
  // Legacy rows: stored value is the old dead public URL  pull the
  // path back out of it.
  const idx = stored.indexOf(PATH_MARKER);
  return stored.slice(idx + PATH_MARKER.length);
}

// Basic path-safety check, applied only to the new bare-path shape
// (legacy URLs already went through extractObjectPath() above, which
// strips everything up to and including PATH_MARKER, so a stray "/",
// "..", or scheme couldn't survive that extraction intact).
function isSafePath(path: string): boolean {
  return (
    !!path &&
    !path.startsWith('/') &&
    !path.includes('..') &&
    !path.includes('\0')
  );
}

// Replaces `attachment_url` with a freshly generated signed URL (or
// null if it can't be resolved/signed). Call this only from
// authenticated admin/partner routes, right before returning the
// response  never cache the result past the request.
export async function signAttachmentUrl(
  attachmentUrl: string | null
): Promise<string | null> {
  if (!attachmentUrl) return null;

  const path = extractObjectPath(attachmentUrl.trim());
  if (!path || !isSafePath(path)) {
    console.error('Invalid or unresolvable booking attachment path:', attachmentUrl);
    return null;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from('booking-attachments')
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error('createSignedUrl failed for booking attachment:', error);
    return null;
  }

  return data.signedUrl;
}

// Batch variant for list views  /api/admin/orders (unlike the
// payment-slips list route) DOES render attachment_url per row
// (BookingsManager.tsx's " ไฟลแนบ" link), so unlike slip_url this
// field can't just be dropped from the list response; sign every
// row here instead.
export async function attachSignedAttachmentUrls<T extends { attachment_url: string | null }>(
  orders: T[]
): Promise<T[]> {
  return Promise.all(
    orders.map(async (order) => ({
      ...order,
      attachment_url: await signAttachmentUrl(order.attachment_url),
    }))
  );
}
