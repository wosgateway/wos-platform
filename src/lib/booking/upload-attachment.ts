// src/lib/booking/upload-attachment.ts
//
// Shared by BookingForm.tsx and JourneyBookingForm.tsx (previously
// each had its own inline client-side upload straight to
// booking-attachments before the order existed — see migration 069
// for why that changed). Call this AFTER POST /api/orders has
// already succeeded and returned order_number + payment_access_token.
//
// Three steps, matching the server side (069_attachment-upload-url-route.ts
// / 069_attachment-confirm-route.ts):
//   1. Ask the server for a signed upload URL scoped to this order.
//   2. Upload the file straight to Supabase Storage using that URL —
//      bytes never touch our own API routes, so there's no Next.js
//      body-size-limit concern even for a 10MB file.
//   3. Confirm with the server, which verifies the object exists and
//      writes orders.attachment_url.
//
// Throws on failure. Callers should catch this separately from the
// order-creation call — a failed attachment upload should not be
// treated as a failed booking; the order already exists either way.

import { createClient } from '@/lib/supabase/client';

export async function uploadBookingAttachment(
  orderNumber: string,
  paymentAccessToken: string,
  file: File
): Promise<void> {
  const urlRes = await fetch(`/api/orders/${orderNumber}/attachment-upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_access_token: paymentAccessToken,
      filename: file.name,
    }),
  });
  const urlResult = await urlRes.json();
  if (!urlRes.ok) {
    throw new Error(urlResult?.error ?? 'failed to get upload url');
  }

  const supabase = createClient();
  const { error: uploadError } = await supabase.storage
    .from('booking-attachments')
    .uploadToSignedUrl(urlResult.path, urlResult.token, file);
  if (uploadError) {
    throw uploadError;
  }

  const confirmRes = await fetch(`/api/orders/${orderNumber}/attachment`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_access_token: paymentAccessToken,
      path: urlResult.path,
    }),
  });
  const confirmResult = await confirmRes.json();
  if (!confirmRes.ok) {
    throw new Error(confirmResult?.error ?? 'failed to confirm attachment');
  }
}
