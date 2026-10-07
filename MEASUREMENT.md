# E4LA Measurement — Source of Truth

Last updated: 2026-10-06. Last live verification: **2026-10-06 on https://www.e4la.org** (initial activation verification 2026-10-04; details below).

## Status summary

| Component | Value | Status |
|---|---|---|
| GTM account / container | Account `E4LA` (6380561827); container named `www.e4la.org`, public ID **`GTM-KMJ83Q66`** (internal 266075324), Web. Published Version 2 "v1 E4LA GA4 + Vision Session events" on 2026-10-04 | LIVE VERIFIED (loads once per page) |
| GA4 | Account `E4LA` (410664670), property `E4LA` (557331300), web stream `https://www.e4la.org` (16042040199), Measurement ID **`G-SKDGBTXKH1`** | LIVE VERIFIED (Realtime received page_view + all custom events) |
| Search Console | Domain property `sc-domain:e4la.org`, verified (existing DNS TXT); sitemap `https://www.e4la.org/sitemap.xml` submitted 2026-10-04 — Status **Success**, 4 pages discovered, last read 2026-10-06. Page indexing report: "Processing data, check again in a day or so" | Configured; indexing data pending (normal Google delay) |
| GA4 Key Events | **`vision_session_submit` only** (primary). `vision_session_start` and all other events are ordinary events. Default `close_convert_lead` / `qualify_lead` unmarked 2026-10-06 (unused). `purchase` is an unmarked placeholder. | LIVE VERIFIED in GA4 Events admin |
| Google Ads | Intentionally not configured; no Ads link, no remarketing, Google Signals off | NOT REQUIRED |
| Consent | ad_storage / ad_user_data / ad_personalization denied in code; analytics_storage `granted` by default; `e4laConsent` hook for future CMP | LIVE VERIFIED in dataLayer defaults |

**Note:** GA4 account also contains an unrelated `Nasimis` account with the Paint Events property (a313309103 / p440334621). It is a separate brand — never edit it from E4LA work. The GA4 UI defaults to it; always switch to account 410664670 / property 557331300.

## Architecture

- One file, `measurement.js`, loaded in `<head>` of exactly four pages: `index.html`, `services.html`, `our-work.html`, `about.html`.
- It loads the single GTM container. **No inline gtag / no second GA4 tag.** GA4 is configured inside GTM only.
- Self-guard: runs only on hosts `www.e4la.org`, `e4la.org` and paths in an explicit **allowlist** (`/`, `/services`, `/our-work`, `/about` + `.html` forms). Anything else (client proposals, contracts, reports, portal, admin, auth stubs, preview hosts) is a no-op even if the file is included by mistake.
- Consent Mode v2 defaults: `ad_storage`, `ad_user_data`, `ad_personalization` = denied (always); `analytics_storage` = `CFG.analyticsConsentDefault`. `window.e4laConsent.grant()/revoke()` is the hook for a future banner. No remarketing/ad tags are installed.
- `window.e4laTrack(event, params)` is the only API; it drops PII-like keys and truncates strings to 100 chars.

## Excluded from E4LA analytics (never include `measurement.js`)

`balensed-proposal/`, `bpm-real-estate-contract/`, `bpm-real-estate-proposal/`, `dr-kevin-sadati-proposal/`, `weho-grill-report/`, `client-agreement/`, `client-portal/`, `admin/`, `portal.html`, `sign-in.html`, `sign-up.html`, `forgot-password.html`, `verify-email.html`, `ui-kit.html`. New client assets are excluded by default (allowlist model): add a page to analytics only by editing `pathAllowlist` AND including the script.

## dataLayer spec (no PII; all events also carry `page_type`)

| Event | Trigger | Params | Meaning | GA4 | Key Event |
|---|---|---|---|---|---|
| `vision_session_start` | Booking modal opens (valid date/time chosen) | `entry_point` (opener id), `session_type` | High-intent: began Vision Strategy Session booking | Event | **Yes (high intent)** |
| `vision_session_step` | Modal reaches step 2–6 (once per step per open) | `step_number`, `step_name`, `service_interest` (fixed checkbox labels, `\|`-joined) | Funnel depth | Event | No |
| `vision_session_submit` | `/api/book` returns OK (calendar event created) | `session_type`, `service_interest`, `steps_completed` | **Primary conversion**: booked Vision Strategy Session | Event | **Yes (primary)** |
| `click_email` | Any `mailto:` click | `link_location` (footer/content/booking_modal) | Micro-interaction, NOT a qualified inquiry | Event | No |
| `click_phone` | Any `tel:` click | `link_location` | Micro. No `tel:` links exist today; handler is dormant | Event | No |
| `contact_submit` | — | — | **NOT REQUIRED**: site has no contact form (contact = `mailto:`). Emails sent are not observable by the site. | — | — |

Never sent: name, email, phone, company, role, goal/challenge/notes text, uploaded files. Newsletter form (`#js-nl`) is not instrumented.

## GTM setup to create (once the container exists)

- Variables: Data Layer Variables for `page_type`, `entry_point`, `session_type`, `step_number`, `step_name`, `service_interest`, `steps_completed`, `link_location`.
- Tag: one GA4 Configuration/Google tag (Measurement ID from the new stream), All Pages. `send_page_view` default; do not add a second page_view.
- Tags: one GA4 Event tag per event above, trigger = Custom Event with the same name.
- Cross-domain: none required (single domain; booking is in-page modal, `/api/book` same origin).
- Internal traffic: define Nasim's IP/office in GA4 Admin → Data filters before reading baselines.
- GA4 Key Events: `vision_session_submit` only. `vision_session_start` stays an ordinary high-intent event (decided 2026-10-06 to avoid inflating conversion counts).
- Link Search Console ↔ GA4 once both exist (property must be verified under the same Google account).
- Google Ads: only when an account exists and campaigns are planned; import GA4 `vision_session_submit` as the conversion OR use a direct tag — never both.

## Verification procedure

1. GTM Preview on https://www.e4la.org/ → exactly one container, one Google tag, one `page_view` per load.
2. Open the booking modal → `vision_session_start` once; step through → one `vision_session_step` per step; confirm a booking → one `vision_session_submit` (use a test slot you cancel afterwards).
3. Click a footer `mailto:` → one `click_email`.
4. GA4 DebugView / Realtime: confirm events and params; confirm hostname is `www.e4la.org`.
5. Load a client proposal page → no GTM request, no dataLayer growth.
6. Mobile viewport repeat of 1–3. No console errors.

Local verification on 2026-10-04 (localhost with a debug host, stubbed `/api/book`) confirmed events 2–3 and absence of PII keys; steps 1/4/5 require the live container.

## Access dependencies

- Nasim (nasim@e4la.org): accept the GTM and GA4 Terms of Service dialogs (account/container forms were pre-filled 2026-10-04: GTM account `E4LA` / container `E4LA Website` Web; GA4 account `E4LA`, property `E4LA`, data-sharing options all off). Then the GTM ID and GA4 Measurement ID can be wired in.

## Baseline

Not recorded. Baselines (users, sessions, organic, landing pages, sources, VSS starts/completions) will be captured only after LIVE VERIFIED.

## GTM container contents (Version 2)

- Variables: Data Layer Variables `DLV - page_type|entry_point|session_type|step_number|step_name|service_interest|steps_completed|link_location`; constant `Const - GA4 Measurement ID` = `G-SKDGBTXKH1`.
- Trigger: `CE - E4LA business events` — Custom Event matching regex `^(vision_session_start|vision_session_step|vision_session_submit|click_email|click_phone)$`.
- Tags: `Google tag - GA4 E4LA` (Initialization – All Pages; sends the single page_view) and `GA4 Event - E4LA business events` (event name = `{{_event}}`; parameters limited to the 8 DLVs above, so nothing outside that allowlist can reach GA4).
- The container JSON used to create this is not stored in the repo; GTM version history is authoritative.

## Six-step Vision Strategy Session funnel

Modal steps: 1 goals → 2 contact → 3 details → 4 priorities → 5 files → 6 review → success screen.
`vision_session_start` = step 1 shown (modal opened with a valid date/time). `vision_session_step` fires once each for steps 2–6 (`step_number`, `step_name`). `vision_session_submit` fires only after `/api/book` returns OK. Backwards/repeat visits to a step do not re-fire it within one open; reopening the modal resets.

## Live verification, 2026-10-04 (https://www.e4la.org)

- GTM script loaded once; one gtag.js (injected by the Google tag); containers present: `GTM-KMJ83Q66`, `G-SKDGBTXKH1`; no console errors on `/` and `/services`.
- GA4 Realtime: exactly 1 `page_view` per page load, `first_visit`, `vision_session_start` ×1 per modal open, steps 2–6 once each per run, `click_email` ×1, `vision_session_submit` ×1.
- Failure path (stubbed `/api/book` → HTTP 500): no `vision_session_submit` in dataLayer or GA4, success screen not shown.
- **Limitation:** `/api/book` was stubbed in the test page (fetch override) so no real calendar event or invite email was created; the UI, GTM and GA4 were real. A real booking has not been used as a test to avoid creating a calendar entry.
- PII: dataLayer payloads inspected — only the allowlisted fields; GTM tag maps only those fields. `test@example.com`, name and phone never appeared.
- Exclusions: `/client-portal/`, `/admin/`, `/bpm-real-estate-contract/` loaded in a browser — no GTM/GA requests, no `dataLayer`, no `e4laTrack`. HTML of `/client-agreement/`, `/portal.html`, `/sign-in.html`, `/sign-up.html`, `/balensed-proposal/`, `/bpm-real-estate-proposal/`, `/dr-kevin-sadati-proposal/`, `/weho-grill-report/`, `/ui-kit.html` contains no analytics reference.
- `click_phone`: not exercised — no `tel:` links exist on the site.
- `contact_submit`: not created — no contact form exists.
- GA4 Enhanced Measurement: Form interactions and Site search turned OFF (booking-modal forms produced stray `form_start`). Google Signals off. Data-sharing options all off.

## Baseline

**Measurement activation date: 2026-10-04** (GTM published, `GTM-KMJ83Q66` live on www.e4la.org). The trustworthy baseline begins here. Traffic from 2026-10-04 includes controlled test sessions (≈2 homepage loads, 2 modal runs, 1 `click_email`, 1 stubbed `vision_session_submit`) — exclude them when reporting; define an internal-traffic filter in GA4 (Admin → Data filters) once Nasim's IP is chosen. No prior history exists and none is inferred. GA4 does not know proposals, contracts or revenue; those require separate integration.

## Closure audit, 2026-10-06

- Re-verified on production (`/our-work`): one `gtm.js`, one `gtag.js`; IDs `GTM-KMJ83Q66`, `G-SKDGBTXKH1` only; consent default `ad_storage`/`ad_user_data`/`ad_personalization` = denied; zero requests to doubleclick/googleadservices/googlesyndication; no `_gcl_*` cookie (only `_ga`, `_ga_SKDGBTXKH1`). Google Signals off.
- Private routes re-tested in a real browser (not HTML only): `/client-agreement/`, `/balensed-proposal/`, `/bpm-real-estate-proposal/`, `/dr-kevin-sadati-proposal/`, `/weho-grill-report/`, `/client-portal/`, `/admin/`, `/bpm-real-estate-contract/`, `/portal.html` (→ `/sign-in`): zero GTM/GA requests, no `dataLayer`, no `e4laTrack`.
- Non-destructive regression: `POST /api/book` with an empty body returns the expected 400 validation errors. Measurement commits changed only static files (HTML includes, `measurement.js`, `script.js`); no `functions/` changes.
- **Real-booking validation: PENDING first legitimate booking.** The server-success → `vision_session_submit` → GA4 chain has been verified only with a stubbed `/api/book`. On the first real booking, confirm one `vision_session_submit` in GA4 Realtime/Events and that a Key Event count appears. Not a blocker.
- Known production state unrelated to measurement: `/api/ops/*` returns 503 `database_not_configured` on www.e4la.org (Client Operations D1 not bound to the public site; pre-existing, tracked in the Client Operations handoff) and `/api/stripe/webhook` returns 503 `stripe_not_configured`. Resend/Google Calendar delivery is only exercisable by a real booking and was not tested.
- GA4 "Key events" over the last 7 days shows 0 because the star was applied after the only test submit; this is expected.
