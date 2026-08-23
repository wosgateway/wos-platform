// src/lib/storage/signed-attachment-url.ts
//
// Companion to signed-slip-url.ts. As of migration 044,
// `booking-attachments` is a private bucket — the old public URLs
// stored in orders.attachment_url (created via
// supabase.storage.from('booking-attachments').getPublicUrl(path) in
// BookingForm.tsx / JourneyBookingForm.tsx) no longer resolve to
// anything viewable. This exchanges the stored path for a
// short-lived signed URL, server-side, from authenticated
// admin/partner routes only — never from a public endpoint.
//
// These are customer-uploaded medical documents/test results
// ("อัปโหลดเอกสาร/ผลตรวจ" in BookingForm.tsx), so treat this at least
// as carefully as payment slips.

import { createServiceClient } from '@/lib/supabase/service';

const PATH_MARKER = '/storage/v1/object/public/booking-attachments/';

// Same TTL as signed-slip-url.ts — long enough for an admin to open
// it after loading the order page, short enough that a copied/leaked
// link stops working quickly.
const SIGNED_URL_TTL_SECONDS = 600;

function extractObjectPath(storedUrl: string): string | null {
  const idx = storedUrl.indexOf(PATH_MARKER);
  if (idx === -1) return null;
  return storedUrl.slice(idx + PATH_MARKER.length);
}

// Replaces `attachment_url` with a freshly generated signed URL (or
// null if it can't be resolved/signed). Call this only from
// authenticated admin/partner routes, right before returning the
// response — never cache the result past the request.
export async function signAttachmentUrl(
  attachmentUrl: string | null
): Promise<string | null> {
  if (!attachmentUrl) return null;

  const path = extractObjectPath(attachmentUrl);
  if (!path) {
    console.error(
      'attachment_url did not match expected booking-attachments path shape:',
      attachmentUrl
    );
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

// Batch variant for list views — /api/admin/orders (unlike the
// payment-slips list route) DOES render attachment_url per row
// (BookingsManager.tsx's "📎 ไฟล์แนบ" link), so unlike slip_url this
// field can't just be dropped from the list response; sign every
// row here instead.
export async function attachSignedAttachmentUrls<
  T extends { attachment_url: string | null }
>(orders: T[]): Promise<T[]> {
  return Promise.all(
    orders.map(async (order) => ({
      ...order,
      attachment_url: await signAttachmentUrl(order.attachment_url),
    }))
  );
}
