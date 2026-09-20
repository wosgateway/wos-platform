import Image from 'next/image';

/**
 * WosLogo — the WOS wordmark, replacing the old text logo
 * ("WOS<span>.os</span>") in Header.tsx.
 *
 * Source file: public/logo/wos-mark.svg (804x210 viewBox, cropped tight
 * to the mark with no baked-in padding — safe to size directly with
 * `height`, unlike the original Wos_Logo.png which had ~230px of empty
 * space above/below the mark inside a 320x320 square).
 *
 * `height={26}` matches the nav bar's text-2xl next to it; `width` is
 * derived from the SVG's own ~3.83:1 aspect ratio (804/210) so the mark
 * never distorts. Adjust `height` here if the header's row height ever
 * changes — every place that renders the logo will follow.
 */
export function WosLogo({ className }: { className?: string }) {
  const height = 26;
  const width = Math.round(height * (804 / 210));

  return (
    <Image
      src="/logo/wos-mark.svg"
      alt="WOS"
      width={width}
      height={height}
      priority
      className={className}
    />
  );
}
