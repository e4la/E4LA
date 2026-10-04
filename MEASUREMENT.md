# E4LA Measurement — Source of Truth

Last updated: 2026-10-04. Last live verification: **NOT YET (code deployed; GTM/GA4 not provisioned)**.

## Status summary

| Component | Status | Detail |
|---|---|---|
| Repo instrumentation (`measurement.js`, `script.js` hooks) | Implemented, locally verified 2026-10-04 | dataLayer events fire once per interaction, no PII |
| GTM container | **NOT CONFIGURED** | None exists under nasim@e4la.org (checked 2026-10-04). Creation needs ToS acceptance by the account owner. |
| GA4 property / web stream | **NOT CONFIGURED** | None exists under nasim@e4la.org. Create via GTM after the container exists. |
| Search Console | **CONFIGURED (domain property verified, sitemap submitted 2026-10-04)** | Domain property `sc-domain:e4la.org` auto-verified for nasim@e4la.org via the pre-existing DNS TXT record (an earlier "no access" was only because the property had never been added to this account). Sitemap `https://www.e4la.org/sitemap.xml` (4 URLs, HTTP 200 application/xml) submitted; Google processing pending, no data yet. |
| Google Ads | **NOT CONFIGURED** | No account under nasim@e4la.org. No campaigns planned → nothing to import. |

**To activate:** set `CFG.gtmId` in `measurement.js` to the container ID. Until then the layer only buffers dataLayer events and loads no third-party script.

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
- GA4 Key Events: `vision_session_submit`, `vision_session_start`.
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
