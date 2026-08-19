import { Star } from 'lucide-react';

/**
 * TestimonialsV2 — "Real Journeys" format (Step 10).
 *
 * ⚠️ SAME PDPA CONSTRAINT AS THE EXISTING Testimonials.tsx: the quotes here
 * are still placeholder copy, not real patients — carried over unchanged
 * from `home.testimonials.items` in messages/*.json (do not launch with
 * these; real reviews need explicit consent, this is health-related
 * personal data).
 *
 * The mockup for this step shows real patient PHOTOS next to each quote.
 * I deliberately did NOT do that here: we have zero real, consented patient
 * photos in the repo, and dropping in a generic stock photo next to a real
 * name + "5.0 rating" would make an unconsented placeholder look like an
 * actual patient — worse than the existing text-only placeholder, not
 * better. Until real, consented photos exist, this version uses a plain
 * initials avatar instead of a photo. Swap `<InitialsAvatar>` for a real
 * `<Image>` per-testimonial once actual consented photos are available —
 * nothing else in the layout needs to change.
 *
 * New translation keys used: home.testimonialsV2.items[].{quote, name,
 * route, service, rating} — added to th/en/lo. `route` and `service` and
 * `rating` are new fields; `quote`/`name` reuse the same placeholder people
 * as home.testimonials for consistency (not new fake identities).
 */

interface TestimonialItem {
  quote: string;
  name: string;
  route: string; // e.g. "Laos → Thailand" or "Thailand"
  service: string;
  rating: number;
}

function InitialsAvatar({ name }: { name: string }) {
  const initials = name.trim().slice(0, 1).toUpperCase();
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-navy text-base font-bold text-white">
      {initials}
    </div>
  );
}

export function TestimonialsV2({
  title,
  items,
}: {
  title: string;
  items: TestimonialItem[];
}) {
  return (
    <section className="section-padding bg-white">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="text-h2 text-center text-navy">{title}</h2>

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
          {items.map((item) => (
            <figure
              key={item.name}
              className="card-shadow flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-6"
            >
              <div className="flex items-center gap-3">
                <InitialsAvatar name={item.name} />
                <div>
                  <p className="font-semibold text-navy">{item.name}</p>
                  <p className="text-xs text-slate-500">{item.route}</p>
                </div>
              </div>

              <span className="w-fit rounded-full bg-medicalBlue-light px-2.5 py-1 text-[11px] font-semibold text-medicalBlue">
                {item.service}
              </span>

              <blockquote className="flex-1 text-sm leading-relaxed text-slate-600">
                “{item.quote}”
              </blockquote>

              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={`h-3.5 w-3.5 ${
                      i < Math.round(item.rating)
                        ? 'fill-gold text-gold'
                        : 'fill-slate-200 text-slate-200'
                    }`}
                  />
                ))}
                <span className="ml-1 text-xs font-medium text-slate-500">
                  {item.rating.toFixed(1)}
                </span>
              </div>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
