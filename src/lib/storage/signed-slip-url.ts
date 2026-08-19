// src/lib/storage/signed-slip-url.ts
//
// As of migration 033, `payment-slips` is a private bucket — the old
// public URLs stored in payments.slip_url (created via
// supabase.storage.from('payment-slips').getPublicUrl(path) in
// my-trip/[orderNumber]/payment/page.tsx) no longer resolve to
// anything viewable. This extracts the object path out of that
// stored URL and exchanges it for a short-lived signed URL, called
// server-side from admin/partner routes only — never from a public
// endpoint.

import { createServiceClient } from '@/lib/supabase/service';

const PATH_MARKER = '/storage/v1/object/public/payment-slips/';

// 10 minutes — long enough for an admin to open the slip after
// loading the order page, short enough that a copied/leaked link
// stops working quickly.
const SIGNED_URL_TTL_SECONDS = 600;

function extractObjectPath(storedUrl: string): string | null {
  const idx = storedUrl.indexOf(PATH_MARKER);
  if (idx === -1) return null;
  return storedUrl.slice(idx + PATH_MARKER.length);
}

// Replaces `slip_url` on each payment with a freshly generated signed
// URL (or null if it can't be resolved/signed), in place. Call this
// only from authenticated admin/partner routes, right before
// returning the response — never cache the result past the request.
export async function attachSignedSlipUrls<T extends { slip_url: string | null }>(
  payments: T[]
): Promise<T[]> {
  const supabase = createServiceClient();

  return Promise.all(
    payments.map(async (payment) => {
      if (!payment.slip_url) return payment;

      const path = extractObjectPath(payment.slip_url);
      if (!path) {
        console.error('slip_url did not match expected payment-slips path shape:', payment.slip_url);
        return { ...payment, slip_url: null };
      }

      const { data, error } = await supabase.storage
        .from('payment-slips')
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

      if (error || !data?.signedUrl) {
        console.error('createSignedUrl failed for payment slip:', error);
        return { ...payment, slip_url: null };
      }

      return { ...payment, slip_url: data.signedUrl };
    })
  );
}
