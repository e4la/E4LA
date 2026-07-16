# PROJECT_CONTEXT.md — E4LA Website

Summary of the current site, based solely on the project files as they exist today.

## What E4LA is

E4LA ("Elevation for Los Angeles") is a strategy and creative consultancy in Los Angeles (est. 2017), offering experience strategy, creative direction, SEO/GEO, and AI/digital innovation services, plus a 1:1 advisory/coaching session product. Contact is via `info@e4la.org`.

## Pages

- **`index.html`** — Home page: hero, services overview, approach/process, stats, "Why E4LA," coaching/advisory section with a booking calendar, closing CTA band, shared footer.
- **`services.html`** — Services detail page: hero, a pinned/scroll-driven panel sequence walking through 5 service categories, closing CTA banner, shared footer.
- **`index.before-neon-cta.html`** — An earlier saved snapshot of the home page (pre "neon CTA" treatment, uses Inter instead of Manrope for the loaded webfont). Kept as a historical reference; not linked from anywhere and not part of the live site — leave as-is.

## File organization

```
index.html                    – home page
services.html                 – services detail page
index.before-neon-cta.html    – older snapshot, not live
style.css                     – single global stylesheet (~10,200 lines), shared by both live pages
script.js                     – single global script (~880 lines), shared by both live pages
assets/                       – images, logo, and video assets (hero video, per-service hover videos, booking artwork)
.claude/                      – Claude Code config + skills (ui-ux-pro-max, etc.)
```

There is no build step — pages are static HTML that reference `style.css` and `script.js` directly (with cache-busting `?v=` query strings on the live pages).

## Design direction

- Dark base theme: background `#07060D`, white text, gold/purple "neon" accent system for CTAs (`.cta-neon`, with `--gold`/`--purple` variants and an animated SVG beam/shimmer border).
- Typography: Manrope (loaded via Google Fonts, weights 200–800), `system-ui`/Arial fallback.
- A palm-leaf motif recurs throughout: the logo, a small palm badge inside every CTA, and a decorative palm SVG symbol.
- Recurring visual pattern: an eyebrow label (`section-eyebrow`) + heading (`section-heading`, often with a `.grad-text` gradient-highlighted span) + supporting copy, repeated per section.
- `style.css` is structured as a long sequence of dated/iterative "PASS"/"FINAL ..." comment blocks that each override or refine earlier rules (not a clean single-pass stylesheet) — later blocks in the file generally win. New styling should be added as new, clearly scoped blocks rather than edits scattered through old passes.

## Navigation

- Shared header (`.nav`) on both live pages: logo (links home), links to Services / Approach (`#approach`) / Advisory (`#coaching`), a "Let's Connect" mailto CTA, and a burger button for mobile.
- Mobile nav is a slide-down panel (`.nav__mobile`) toggled by `#js-nav-burger`, driven entirely by `script.js` (adds `is-open` / toggles `aria-expanded` / locks scroll via `body.nav-open`). Closes on link click, on `Escape`, and automatically if the viewport crosses back above 701px.
- Nav border color shifts on scroll past 60px (handled via a scroll listener + `requestAnimationFrame`).
- Footer (shared, full 4-column layout with logo, socials, services/company/resources links, and a newsletter form) is duplicated identically in both `index.html` and `services.html`.

## Responsive behavior

- No CSS framework/grid system — layout is hand-written with a wide range of ad hoc breakpoints across the stylesheet's history: common ones are `1280px, 1200px, 1180px, 1120px, 1100px, 1024px, 980px, 960px, 900px/899px, 780px, 768px, 700px/701px, 640px, 560px, 430px`.
- Several interactive features are explicitly **desktop-only** and fall back to a simpler static/stacked layout below a breakpoint (see below): the 3D service-card tilt, and the pinned scroll-step section on `services.html`.
- `prefers-reduced-motion: reduce` is respected throughout — auto-cycling timelines, the CTA beam shimmer, and the tilt effect all short-circuit to a static state when set.

## Pinned-scroll sections

- **`services.html` — `.svcd-pin`**: a 500vh-tall wrapper holding 5 service-category panels (`.svcd-pin__panel`). `script.js` manually toggles the stage between `position: fixed` / `absolute` / normal flow based on scroll position (deliberately *not* using CSS `position: sticky`, because the site's global `body { overflow-x: hidden }` breaks sticky positioning for descendants in Chrome/Safari). Panel transform/opacity and each panel's decorative "blob" (scale/rotation/blur) are driven continuously by scroll progress. A row of dots (`.svcd-pin__dot`) tracks the active panel.
  - Gated to `min-width: 640px` **and** `pointer: fine` — below that, or on coarse/touch pointers, it tears down to a plain stacked list (no scroll-jacking).
  - Layout-critical positioning is asserted via inline `!important` styles from JS as a deliberate safeguard against stale/cached CSS not applying — visual styling (colors, fonts) still comes from `style.css`.

## Other interactions and animations (`script.js`)

- **Scroll reveal**: any element with `[data-r]` (optionally staggered via `data-d="n"`) fades/slides in once via `IntersectionObserver`, adding an `.in` class.
- **Hero word scramble**: `#js-word` cycles through a word list (`experiences, brands, stories, presence, impact, culture`) with a scramble/decode text effect every 2s.
- **Service cards (`.svc-card`)**: idle cards auto-drift with a per-card "personality" (distinct sine-wave frequency/phase/amplitude combo) via CSS custom properties (`--svc-rx/--svc-ry/--svc-scale`); hovering/focusing freezes a card flat instead of tracking the pointer. Gated to `hover:hover`, `pointer:fine`, `min-width:900px`, and disabled under `prefers-reduced-motion`. Each card's icon is actually a muted looping `<video>` frozen at frame 0 at rest, playing only while hovered/focused (independent of the tilt gating, so it also works on touch).
- **CTA neon beam + badge sizing (`.cta-neon`)**: for every CTA button, JS measures the button's true rendered height (temporarily zeroing the badge box to avoid a feedback loop) to size the circular palm badge, and builds/sizes a repeating SVG gradient traced around the button's border (3 evenly-spaced bright "peaks", animated via SMIL `animateTransform`) for the shimmer effect. Recomputed on load and on resize (via `ResizeObserver` where available).
- **Approach timeline (`#approach .tstep`)** and **coaching "how it works" timeline (`#coaching .coaching__timeline li`)**: both auto-cycle through their steps on a timer (1100ms and 2000ms respectively), pausing when the tab is hidden and respecting reduced motion (lights step 1 and stops).
- **Audience selector cards** (`.aud-card`, coaching section): click/keyboard-selectable single-choice cards, styled via inline style toggling (not classes).
- **Calendar widget** (coaching section): plain date-cell selection (adds/removes `.cal__date--today`); "Book Session" button opens a `mailto:` link.
- **Newsletter form** (`#js-nl`, footer): client-side only — shows a checkmark on submit, no real submission/backend.
- **Smooth scroll delegation**: any `[data-scroll-to="#selector"]` element smooth-scrolls to that target on click.

## Repeated components

- `.cta-neon` (gold/purple neon CTA button, used ~10 times across both pages: nav, mobile nav, hero, CTA band, coaching booking, services CTA).
- Section intro pattern: `section-eyebrow` + `section-heading` (+ optional `.grad-text` span) + `section-description`/`section-cta`.
- `.svc-card` service cards (home) and `.svcd-pin__panel` service panels (services page) both represent "service categories" but are independently structured/styled.
- Icon system: a single inline `<svg>` symbol library (`<symbol id="i-...">`) defined once per page and referenced via `<use href="#i-...">` throughout.
- Footer is byte-for-byte duplicated between `index.html` and `services.html`.

## Known constraints worth remembering

- `body { overflow-x: hidden }` is global and is the reason the services pinned-scroll section can't use `position: sticky` — see above.
- Live pages use `?v=` cache-busting query strings on `style.css`/`script.js`/asset URLs; bump these when shipping a change that must not be served stale.
- `style.css` history is additive/override-heavy (many `!important` rules from successive "FINAL ..." passes) rather than a clean single source of truth per property — check for later overriding blocks before assuming an early rule is the one in effect.
