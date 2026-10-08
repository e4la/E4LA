# CLAUDE.md — E4LA Website

Project rules for working on this codebase. These are permanent and apply to every session.

## Stack

- Vanilla HTML, CSS, and JavaScript only.
- Do **not** convert this project to React, Next.js, TypeScript, Tailwind, or shadcn — not for a single component, not "just for this section." If a task seems to require one of these, stop and flag it instead of introducing it.
- Motion is used as **Motion for JavaScript** (the vanilla ESM build), never Motion for React.

## Visual identity — do not change without explicit approval

- Preserve the existing visual identity: typography (Manrope), color palette (dark `#07060D` base, gold/purple neon CTA system), copy/content, responsive behavior, and all currently working interactions.
- Do not redesign sections or make visible UI changes unless explicitly asked.
- Before any large or structural change, explain the plan first and get confirmation.

## Code conventions

- Reuse existing HTML classes whenever possible instead of inventing new ones (e.g. `svc-card`, `cta-neon`, `svcd-pin__*`, `tstep`, `grad-text`, `section-heading`, `data-r`/`data-d` reveal hooks).
- When adding new classes to an element, preserve every existing class already on it.
- Keep animation code separate from core functionality:
  - `script.js` holds core interaction logic (nav, forms, calendar, pinned scroll, tilt, timelines, CTA beam layout). Keep it a plain (non-module) script.
  - `motion.js` is the dedicated home for any Motion-driven animation work. It is loaded as a `type="module"` script, after `script.js`, only on pages that need it.
- Make changes section by section — do not rewrite entire HTML pages or the whole stylesheet in one pass. `style.css` in particular is a long, iterative history of layered/overriding passes; add scoped, targeted rules rather than restructuring existing blocks.
- Do not delete or rewrite existing working functionality as a side effect of an unrelated change.

## 21st.dev

- Use 21st.dev primarily as a **visual and interaction reference** (layouts, patterns, motion ideas) — not as a source of code to install.
- Do not directly install React/Tailwind/shadcn components from 21st.dev into this project. Reimplement any borrowed idea in vanilla HTML/CSS/JS, matching the conventions above.

## Workflow expectations

- Before large changes: explain the plan and wait for approval.
- After changes: test both desktop and mobile behavior (the site has pinned-scroll and breakpoint-dependent behavior that silently falls back to simpler layouts below certain widths — verify both states).
- Prefer editing existing files over creating new ones.

## Lean execution: files, tokens, and verification
- **One source of truth.** Search for the existing owner file before creating anything. Update it in place; add a file only when code, an existing workflow, or a clearly distinct reusable function requires one. No duplicate briefs, `-v2`/`-final` copies, speculative documentation, or committed temporary logs.
- **Smallest useful context.** Read relevant paths and diffs first; avoid repeated full-repo dumps, redundant research, and reopening unchanged large files. Reuse previously verified findings when still current.
- **Smallest safe change.** Make focused edits and run proportionate tests; do not sacrifice functional, mobile, accessibility, or production verification to save tokens. Keep required build outputs only where workflows need them.
- **Concise reporting.** State what changed, test evidence, and remaining blockers without repeating project history. Before removing apparent duplicates, check references, automation consumers, and needed history.

## Reference

See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for a summary of the current site structure, pages, and interactions.
