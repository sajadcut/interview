# Visual Product Target

> Status: ACTIVE implementation acceptance target
> Date: 2026-08-31

This document prevents a recurrence of treating a generic application shell as a completed product UI.

## Principle

A route is not visually complete merely because it has routing, a card, an empty state, or a page title. Visual completion requires production-grade information architecture and interaction density comparable to the product references approved by the product owner.

## Current approved target surfaces

1. Command Center
2. Job Workspace — Overview
3. Job Workspace — Candidates
4. Job Workspace — Pipeline / Kanban
5. AI-assisted Job Builder
6. Organization-wide Candidates table
7. Candidate Intelligence Workspace
8. Interviews list
9. AI Interview Review / Scorecard surface
10. Job Workspace — Sourcing Agent / source policy / discovered candidates
11. Job Workspace — Outreach + screening + scheduling
12. Candidate Intelligence — Assessment evidence
13. Candidate-facing — consent / device-check / interview readiness
14. Recruiting Analytics — funnel / source performance / review load / AI governance
15. Organization Governance — RBAC / retention / privacy requests / interview release policy

## Required characteristics

- dark enterprise navigation with clear hierarchy and active states;
- persistent top actions/search where appropriate;
- information-dense B2B layout, not a generic card gallery;
- compact typography and spacing appropriate for recruiter workflows;
- tables, tabs, filters, saved-view affordances and contextual actions;
- visible AI recommendation/provenance language without presenting AI as final authority;
- evidence/score structures that can later connect to domain APIs;
- sourcing retrieval signals visually distinct from final hiring/scorecard signals;
- source-policy state visible where external discovery is involved;
- outreach factual answers show approved grounding/approval state;
- screening hard minimums and human-review state are distinguishable;
- interview plan/release-unit state and evidence coverage are visible;
- assessment runner/integrity signals are review aids, not automatic misconduct findings;
- analytics distinguish operational/retrieval metrics from evidence-backed hiring scores;
- retention/legal-hold/privacy-request states are reviewable and auditable;
- clear internal-app vs candidate-app separation;
- candidate consent/recording/no-biometric-inference disclosures are understandable;
- responsive behavior;
- direction-aware RTL/LTR layout primitives;
- no unsupported psychological/biometric visualizations;
- no invented production metrics presented as real customer data.

## Development fixtures

Until the relevant domain endpoints and migrations are runtime-validated, the visual target may use deterministic development fixtures from `apps/web/lib/demo-data.ts` and route-local fixture constants.

Fixtures are allowed only to exercise real React/Next.js UI. They must not be described as persisted production data and must be replaced with typed API data as each domain slice lands.

The first visual implementation is English-content-first to match the approved visual references. English is therefore the default fixture locale. `NEXT_PUBLIC_DEFAULT_LOCALE=fa` explicitly enables the Persian shell for RTL review. Until complete Persian fixture copy is implemented, English fixture-backed product content remains LTR so tables and information hierarchy are not reversed merely because the shell is Persian.

## Visual acceptance gate

A UI ticket is not DONE until all applicable items are true:

```text
route exists
+ actual product anatomy implemented
+ hierarchy matches approved reference direction
+ empty/loading/error states considered
+ desktop layout reviewed
+ responsive behavior reviewed
+ RTL/LTR direction reviewed
+ Persian/English copy reviewed where in scope
+ AI provenance / evidence / human-control boundary visible where applicable
+ screenshot taken from executable application
+ screenshot compared to approved target
+ lint/typecheck/build pass on the same HEAD
```

Static mock images generated outside the application do not satisfy this gate.

## Executable browser reviews

### Review 1

The first real Windows/Next.js screenshots were reviewed for:

```text
/app
/app/jobs
/app/candidates
```

They proved that the routes and enterprise shell render, but did not pass visual acceptance. Shared gaps included mixed RTL shell/LTR fixture hierarchy, missing active navigation, overly small typography/density, an over-prominent fixture notice, and weak shell/action hierarchy.

Visual iteration 1 fixed the default fixture direction strategy, active navigation, typography/table density and shared shell/primitives.

### Review 2

Fresh screenshots of the same three routes showed a material improvement: reading order, active state, tables and hierarchy were corrected. The remaining concrete shell defect was the bottom profile card overlapping Settings at shorter desktop viewport heights.

Visual iteration 2 replaced the sidebar absolute footer with a flex/scroll-safe layout so navigation remains reachable and the profile card does not cover Settings.

Review 2 still does not imply global visual acceptance. The deeper product surfaces below require executable review:

```text
/app/jobs/senior-backend-engineer
/app/jobs/senior-backend-engineer/sourcing
/app/jobs/senior-backend-engineer/outreach
/app/jobs/senior-backend-engineer/interviews
/app/jobs/senior-backend-engineer/scorecards
/app/candidates/ali-rahimi
/app/candidates/ali-rahimi/assessments
/app/interviews/ali-rahimi
/app/analytics
/app/settings
/candidate
```

## Current implementation state

The repository now contains executable UI anatomy spanning M1–M6, including sourcing/source-policy, grounded outreach/screening/scheduling, evidence-first scorecards, controlled interview release state, candidate consent/readiness, assessment evidence/runner boundaries, recruiting analytics and governance settings.

These new routes are **coded, not visually accepted**. The latest HEAD still requires migration validation, OpenAPI regeneration, lint/typecheck/test/build and executable browser screenshot review before the new surfaces can be marked validated.
