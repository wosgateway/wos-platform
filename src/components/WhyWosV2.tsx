import { ShieldCheck, Wallet, Globe2, Headphones } from 'lucide-react';

/**
 * WhyWosV2 — "Why WOS" rebuilt as a typography-first module (Step 6).
 *
 * Parallel to the existing WhyCard.tsx + "WHY WOS" section in page.tsx —
 * neither of those is modified. This version drops the photo-card treatment
 * and leans on scale/weight/whitespace instead: big index numerals, a small
 * icon accent, bold title, quiet description. No new translation keys —
 * reuses `home.why.items` (title/desc) as-is, so copy stays in sync with the
 * live section automatically.
 *
 * NOTE: I don't have the literal text of brief item 11 in front of me, only
 * "typography-first module" from your step list — so treat the exact visual
 * (numerals + icon strip + divider grid) as my interpretation, not a
 * pixel-verified match to the brief. Flag it if item 11 specifies something
 * more precise (e.g. exact icon set, a different grid, no numerals) and I'll
 * adjust.
 */

const ICONS = [ShieldCheck, Wallet, Globe2, Headphones];

export function WhyWosV2({
  title,
  items,
}: {
  title: string;
  items: { title: string; desc: string }[];
}) {
  return (
    <section className="section-padding bg-white">
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-h2 text-center text-navy">{title}</h2>

        <div className="mt-14 grid grid-cols-1 divide-y divide-navy/10 border-t border-navy/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4 lg:border-t-0">
          {items.map((item, i) => {
            const Icon = ICONS[i] ?? ShieldCheck;
            return (
              <div key={i} className="px-6 py-8 first:pt-8 sm:px-8">
                <div className="flex items-center gap-3">
                  <span className="text-h3 text-gold/40">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <Icon className="h-5 w-5 text-medicalBlue" strokeWidth={1.75} />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-navy">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
