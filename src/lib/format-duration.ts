/** Presentation only. Canonical database/RPC/application values are integer minutes. */
export function formatDurationMinutes(
  minutes: number | null | undefined,
  locale: string
): string | null {
  if (minutes == null || !Number.isInteger(minutes)) return null;
  const unit = locale === 'lo' ? 'ນາທີ' : locale === 'en' ? 'minutes' : 'นาที';
  return `${minutes} ${unit}`;
}
