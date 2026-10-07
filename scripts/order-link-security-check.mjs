#!/usr/bin/env node

import fs from 'node:fs';

const checks = [
  {
    file: 'src/components/BookingForm.tsx',
    required: ['payment_access_token', '?token='],
    label: 'BookingForm customer order link',
  },
  {
    file: 'src/components/JourneyBookingForm.tsx',
    required: ['payment_access_token', '?token='],
    label: 'JourneyBookingForm customer order link',
  },
  {
    file: 'src/app/[locale]/quote/[orderNumber]/page.tsx',
    required: ['?token=', 'encodeURIComponent(token)'],
    label: 'Quote page customer order link',
  },
  {
    file: 'src/lib/notify/trip-reminder-whatsapp.ts',
    required: ['/my-trip/token/', 'accessToken'],
    label: 'Trip reminder secure link',
  },
];

let failed = false;
for (const check of checks) {
  const source = fs.readFileSync(check.file, 'utf8');
  const missing = check.required.filter((needle) => !source.includes(needle));
  if (missing.length) {
    failed = true;
    console.error(`FAIL ${check.label}: missing ${missing.join(', ')}`);
  } else {
    console.log(`PASS ${check.label}`);
  }
}

const customerWhatsapp = fs
  .readFileSync('src/lib/notify/customer-whatsapp.ts', 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');
for (const forbidden of ['/my-trip/', '/quote/']) {
  if (customerWhatsapp.includes(forbidden)) {
    failed = true;
    console.error(`FAIL customer WhatsApp must not emit bare order URL: ${forbidden}`);
  }
}

console.log(failed ? 'ORDER LINK SECURITY CHECK FAILED' : 'ORDER LINK SECURITY CHECK PASSED');
process.exit(failed ? 1 : 0);
