import type { ReactNode } from 'react';
import { Phone } from 'lucide-react';

// Single source of truth for the 4 contact channels, shared between
// <ContactFab /> (desktop floating button) and <MobileStickyCta />
// (mobile bottom bar's "คุยกับ WOS" channel picker) so the numbers/IDs
// and icons never drift out of sync between the two.
export const PHONE_NUMBER_TH = '+66864522644';
const WHATSAPP_NUMBER = '66864522644';
const LINE_ID = '@vlf9996z';
const MESSENGER_PAGE = 'wosasia';

export function LineIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden="true">
      <path d="M12 2C6.486 2 2 5.663 2 10.2c0 4.075 3.585 7.487 8.427 8.107.328.07.775.216.888.497.101.254.066.652.032.909l-.144.865c-.04.254-.203.996.874.543 1.077-.454 5.813-3.425 7.93-5.864C21.41 13.434 22 11.887 22 10.2 22 5.663 17.514 2 12 2Zm-3.5 10.9H6.9a.4.4 0 0 1-.4-.4V8a.4.4 0 0 1 .8 0v4.1h1.2a.4.4 0 0 1 0 .8Zm1.9-.4a.4.4 0 0 1-.8 0V8a.4.4 0 0 1 .8 0v4.5Zm4.6 0a.4.4 0 0 1-.712.25l-2.088-2.85v2.6a.4.4 0 0 1-.8 0V8a.4.4 0 0 1 .712-.25l2.088 2.85V8a.4.4 0 0 1 .8 0v4.5Zm2.9.4h-1.7a.4.4 0 0 1-.4-.4V8a.4.4 0 0 1 .4-.4h1.7a.4.4 0 0 1 0 .8h-1.3v1.05h1.3a.4.4 0 0 1 0 .8h-1.3v1.05h1.3a.4.4 0 0 1 0 .8Z" />
    </svg>
  );
}

export function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-6 w-6 fill-white" aria-hidden="true">
      <path d="M16.004 3C9.377 3 4 8.373 4 15c0 2.386.696 4.61 1.897 6.478L4 29l7.72-1.86A11.94 11.94 0 0 0 16.004 27C22.63 27 28 21.627 28 15S22.63 3 16.004 3Zm7.02 16.98c-.293.824-1.462 1.53-2.397 1.727-.638.135-1.47.243-4.27-.917-3.582-1.483-5.89-5.1-6.07-5.34-.176-.24-1.45-1.93-1.45-3.68s.912-2.61 1.235-2.967c.324-.357.706-.446.94-.446.235 0 .47.002.674.012.216.01.507-.082.793.605.293.7.994 2.42 1.08 2.596.088.176.147.383.03.62-.117.238-.176.383-.352.588-.176.206-.37.46-.53.618-.176.176-.36.367-.155.72.206.352.916 1.51 1.966 2.446 1.35 1.205 2.49 1.578 2.842 1.755.352.176.558.147.764-.088.206-.235.882-1.028 1.117-1.38.235-.353.47-.294.793-.176.323.117 2.048.966 2.4 1.142.352.176.587.264.674.412.088.147.088.85-.205 1.674Z" />
    </svg>
  );
}

export function MessengerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.9 1.451 5.488 3.72 7.178V22l3.396-1.864c.907.251 1.869.386 2.884.386 5.523 0 10-4.145 10-9.279C22 6.145 17.523 2 12 2Zm1.008 12.49-2.546-2.716-4.97 2.716 5.467-5.804 2.608 2.716 4.907-2.716-5.466 5.804Z" />
    </svg>
  );
}

export type ContactChannel = {
  key: string;
  href: string;
  label: string;
  icon: ReactNode;
  bg: string;
  // tel: should hand off straight to the phone app, not open a browser tab.
  newTab: boolean;
};

// whatsappMessage is passed in (from useTranslations('whatsapp')('message')
// in the calling client component) rather than read here, so this file
// stays a plain data/icon module and doesn't need 'use client' itself.
//
// Order is intentional: Messenger and WhatsApp are prioritized for
// Lao/international customers, followed by LINE for Thai customers,
// then Phone last.
export function getContactChannels(whatsappMessage: string): ContactChannel[] {
  return [
    {
      key: 'messenger',
      href: `https://m.me/${MESSENGER_PAGE}`,
      label: 'Messenger',
      icon: <MessengerIcon />,
      bg: 'bg-[#0084FF]',
      newTab: true,
    },
    {
      key: 'whatsapp',
      href: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(whatsappMessage)}`,
      label: 'WhatsApp',
      icon: <WhatsAppIcon />,
      bg: 'bg-[#25D366]',
      newTab: true,
    },
    {
      key: 'line',
      href: `https://line.me/ti/p/${LINE_ID}`,
      label: 'Line',
      icon: <LineIcon />,
      bg: 'bg-[#06C755]',
      newTab: true,
    },
    {
      key: 'phone',
      href: `tel:${PHONE_NUMBER_TH}`,
      label: 'Phone',
      icon: <Phone className="h-6 w-6 text-white" strokeWidth={2.25} aria-hidden="true" />,
      bg: 'bg-primary',
      newTab: false,
    },
  ];
}
