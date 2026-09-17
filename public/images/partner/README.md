# /public/images/partner — TEMPORARY PLACEHOLDERS

Every `.webp` in this folder is a generated beige/navy placeholder, not artwork. They exist so `/partner` renders correctly on staging before the photography lands.

To ship the real page: replace each file with the real photo, **keeping the exact same filename and ratio**. Nothing in the code needs to change — `src/content/partner/images.ts` reads these paths, and alt text for th / en / lo lives there.

See `IMAGE-ASSET-SPEC.md` at the root of this package for the shot list, ratios, style direction and file-size targets.

| File | Ratio | Placeholder tone |
|------|-------|------------------|
| `hero-wellness-traveler.webp` | 16:9 | navy |
| `why-welcome.webp` | 4:3 | beige |
| `journey-wide.webp` | 21:9 | navy |
| `group-healthcare.webp` | 4:3 | beige |
| `group-wellness.webp` | 4:3 | beige |
| `group-hospitality.webp` | 4:3 | beige |
| `founding-experience.webp` | 4:5 | navy |
| `step-apply.webp` | 4:3 | beige |
| `step-review.webp` | 4:3 | beige |
| `step-build.webp` | 4:3 | beige |
| `step-launch.webp` | 4:3 | beige |
| `cta-wellness-thailand.webp` | 16:9 | navy |

Navy placeholders sit where the real image carries a scrim or a dark section (hero, journey, founding, final CTA), so the layout reads the same before and after the swap.

Before launch: make sure no file here still says PLACEHOLDER. A quick check — `grep -rl "PLACEHOLDER" public/images/partner` won't work on binaries, so just open the page and look; every placeholder is labelled in the centre of the frame.
