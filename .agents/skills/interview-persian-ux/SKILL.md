---
name: interview-persian-ux
description: Build and review Interview's Persian-first RTL recruiter/admin UI and bilingual candidate experience. Use when creating or revising pages, CRUD tables, forms, responsive navigation, Persian digits/dates, typography, accessibility, and real-browser visual acceptance.
---

# Persian enterprise UX and accessibility

Read `docs/visual-product-target.md`, `AGENTS.md`, `projectstate.md`, and inspect the current page/component before changing the product. This is a **real Next.js UI** skill, not an image/mockup-generation instruction.

## Implementation surfaces

- Internal recruiter pages: `apps/web/app/app/`.
- Candidate boundary: `apps/web/app/candidate/`, `apps/web/components/candidate/`.
- Shared UI and permissions: `apps/web/components/product/`, `apps/web/components/recruiting/`.
- Localization and numeric display: `apps/web/lib/i18n.ts`, `apps/web/lib/fa-numbers.ts`.
- Local IRANSansX font configuration: use existing project typography configuration and root `font/`; do not add arbitrary external font dependencies.

## Workflow

1. Start from the user's real workflow and authorized role. Inspect loaded data, API errors, empty states and permissions before sketching controls. Respect recruiter/internal vs candidate security and language boundaries.
2. Default internal pages to Persian, RTL reading order, consistent `IRANSansX` weights, compact but readable enterprise density and semantic navigation. Prefer CSS logical properties (`start/end`, `ps/pe`, `border-s/e`) rather than hard-coded left/right.
3. Render human-facing quantities, dates, percentages and statuses via shared `fa-numbers`/`i18n` helpers; do not modify UUIDs, code snippets, API payloads, form machine values or technical identifiers merely to display Persian numerals.
4. Preserve candidate-specific `fa/en` and LTR/RTL behavior. Do not force untranslated English content into RTL. Keep candidate consent, recording disclosure, accessibility and media error recovery understandable.
5. Collection pages must support appropriate create, search, filters, sort, view/edit, single/bulk delete with confirmation, role-aware visibility and helpful failures. Selection must not silently include hidden rows after a filter/search change. Respect server-side dependency rules.
6. Every route needs loading, empty, validation, success and error feedback, keyboard focus, appropriate accessible names, disabled/busy states, sensible tab order, mobile/tablet/desktop layout and no horizontal overflow of the document. Dense tables can scroll in their own region.
7. Render from executable Next.js code. Verify actual persisted data vs visibly labeled development fixtures; never pass off mock screenshots or synthetic statistics as product acceptance evidence.
8. Compare actual browser screenshots in Persian and English against the approved visual target. Inspect typography, spacing, dialogs, modal focus, confirmation copy, sidebar/mobile navigation, RTL mirroring and candidate media UX.

## Checks

```bash
npm run web:contracts
npm run candidate-interview-ui:contract:check
npm run lint
npm run typecheck
npm run build
npm run e2e
```

Also run specific number-formatting/component tests and capture executable screenshots at narrow, tablet and desktop viewports. Record which validations were actually run and which require a local browser/server. Never claim a route visually complete based solely on lint/build.

## Acceptance evidence

Provide route list, screenshots or browser-observation notes, fa/en and responsive coverage, permission/CRUD/error-state checks, accessibility issues and remaining `VALIDATION_PENDING` items.
