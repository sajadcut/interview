# Visual Product Target

> Status: ACTIVE implementation acceptance target
> Date: 2026-08-31

This document prevents a recurrence of treating a generic application shell as a completed product UI.

## Principle

A route is not considered visually implemented merely because it has routing, a card component, an empty state, or a page title.

For the internal recruiter product, visual completion requires production-grade information architecture and interaction density comparable to the approved product references supplied by the product owner.

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

## Required characteristics

- dark enterprise navigation with clear hierarchy and active states;
- persistent top actions/search where appropriate;
- information-dense B2B layout, not a card gallery;
- compact typography and spacing appropriate for recruiter workflows;
- tables, tabs, filters, saved-view affordances and contextual actions;
- visible AI provenance/recommendation language without presenting AI as final authority;
- evidence/score structures that can later connect to domain APIs;
- clear internal-app vs candidate-app separation;
- responsive behavior;
- RTL/LTR capable layout primitives;
- no unsupported psychological/biometric visualizations;
- no invented production metrics presented as real customer data.

## Development fixtures

Until M1 domain endpoints exist, the visual target may use deterministic development fixtures from `apps/web/lib/demo-data.ts`.

Fixtures are allowed only to exercise real React/Next.js UI. They must not be described as persisted production data and must be replaced with typed API data as each domain slice lands.

## Visual acceptance gate

A UI ticket is not DONE until all applicable items are true:

```text
route exists
+ actual product anatomy implemented
+ hierarchy matches approved reference direction
+ empty/loading/error states considered
+ desktop layout reviewed
+ responsive behavior reviewed
+ RTL/LTR reviewed where applicable
+ screenshot taken from executable application
+ screenshot compared to approved target
+ lint/typecheck/build pass
```

Static mock images generated outside the application do not satisfy this gate.

## Current implementation state

The current `main` contains coded visual implementations for all nine target surfaces above. They are fixture-backed and require local runtime/build/screenshot validation before visual acceptance can be marked complete.
