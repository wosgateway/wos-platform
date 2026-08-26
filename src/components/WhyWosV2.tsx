import { ShieldCheck, Wallet, Globe2, Headphones } from 'lucide-react';

/**
 * WhyWosV2 — "Why WOS" rebuilt as a typography-first module (Step 6).
 *
 * Parallel to the existing WhyCard.tsx + "WHY WOS" section in page.tsx —
 * neither of those is modified. No new translation keys — reuses
 * `home.why.items` (title/desc) as-is, so copy stays in sync with the live
 * section automatically.
 *
 * v2 update: swapped the flat divider-grid layout for bordered cards with a
 * slow-moving gradient outline (gold -> medicalBlue -> gold), so each card
 * reads clearly against the white section background instead of blending
 * into it. Grid is 2-up from the smallest breakpoint (was 1-up) specifically
 * to cut mobile scroll height in half; it steps up to 4-up on lg like
 * before. Animation runs via CSS background-position, respects
 * prefers-reduced-motion (motion-safe:), and is purely decorative — no
 * layout shift.
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
      <style>{`
        @keyframes wos-why-border-flow {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
      `}</style>

      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-h2 text-center text-navy">{title}</h2>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:mt-14 sm:gap-5 lg:grid-cols-4 lg:gap-6">
          {items.map((item, i) => {
            const Icon = ICONS[i] ?? ShieldCheck;
            return (
              <div
                key={i}
                className="group relative rounded-2xl p-[1.5px] transition-transform duration-300 hover:-translate-y-1"
                style={{
                  backgroundImage:
                    'linear-gradient(120deg, #C9974A 0%, #1D63A6 35%, #C9974A 70%, #1D63A6 100%)',
                  backgroundSize: '200% 200%',
                }}
              >
                {/* Animated gradient "frame" — same element as the fill, just
                    slid via background-position so the outline itself seems
                    to travel around the card continuously. */}
                <div className="absolute inset-0 rounded-2xl motion-safe:animate-[wos-why-border-flow_5s_linear_infinite]" />

                <div className="relative flex h-full flex-col rounded-[15px] bg-white p-4 shadow-card transition-shadow duration-300 group-hover:shadow-card-hover sm:p-6">
                  <div className="flex items-center justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-medicalBlue-light sm:h-11 sm:w-11">
                      <Icon className="h-4 w-4 text-medicalBlue sm:h-5 sm:w-5" strokeWidth={1.75} />
                    </span>
                    <span className="text-xl font-bold text-gold/30 sm:text-h3">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-semibold leading-snug text-navy sm:mt-4 sm:text-lg">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500 sm:mt-2 sm:text-sm">
                    {item.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
