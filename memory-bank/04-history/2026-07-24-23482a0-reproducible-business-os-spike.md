# Reproducible Business OS spike

Date: 2026-07-24

## Commit

- `business-os` `23482a0` — Publish reproducible Business OS spike runbook
- Pushed to `tinyfatco/business-os` `main`

## What changed

- Added one focused verifier for awareness, identity, collaboration, Sendly,
  Rocket projection, the FOSS source boundary, and optional live local Rocket
  projection.
- Added a complete spike runbook covering:
  - what is upstream Rocket.Chat and what TinyFat added;
  - why the visible real-time monitoring page is upstream but not yet backed by
    TinyFat awareness;
  - the clean-history MIT/FOSS import decision;
  - local verification and self-managed Rocket setup;
  - Troublemaker hostd commits and native Gmail proof;
  - an acceptance-evidence matrix;
  - known production gaps.
- Updated the root status from active construction to a working spike.

## Verification

- `node scripts/verify-tinyfat-spike.mjs`: passed.
- With the localhost-only Rocket credential:
  `TINYFAT_VERIFY_ROCKET=1 node scripts/verify-tinyfat-spike.mjs`: passed.
- Focused package totals:
  - awareness 6/6;
  - customer identity 11/11;
  - relationship collaboration 2/2;
  - Sendly bridge 3/3;
  - Rocket projection 6/6.
- FOSS boundary check: passed.
- Full local integration created:
  - customer channel `cus_local_cross_14933b93e694`;
  - Rocket room `6a631104c41cf1249510e178`;
  - 12 contiguous canonical events;
  - 11 visibility-allowed room posts;
  - 11/11 duplicate-safe projection replays;
  - one fake provider call and zero Sendly network calls.

## Deployment and QA

- The public `business-os` main branch is current.
- The Troublemaker bridge remains on pushed branch
  `codex/troublemaker-business-os-20260723`; it was not deployed to a resident.
- The self-managed Rocket workspace remains localhost-only and unregistered
  with Rocket.Chat Cloud.
- No live Sendly, Slack, or customer route changed.
