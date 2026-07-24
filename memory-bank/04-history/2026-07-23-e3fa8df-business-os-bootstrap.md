# TinyFat Business OS bootstrap

**Date:** 2026-07-23
**Commits:** `8d36c0b`, `356368f`, `e3fa8df`

## Shipped

- Created the public `tinyfatco/business-os` repository from a clean-history
  import of the Rocket.Chat 8.6.1 FOSS tree.
- Removed `ee/` and `apps/meteor/ee/` before the root commit and recorded exact
  upstream tag and commit provenance.
- Added a CI-enforced FOSS boundary and repaired stale workspace dependencies
  left by the upstream fossify script.
- Replaced surviving commercial license calls with an independently written
  community policy that activates no paid modules, limits, or cloud license.
- Removed startup and source paths that depended on removed media-call,
  presence, and Enterprise omnichannel packages.
- Set the initial TinyFat Business OS name and product architecture.
- Defined the awareness stream as the canonical customer relationship record.
- Added an encrypted append-only JSONL awareness store with strict
  per-customer ordering, idempotency, a tamper-evident hash chain, replay, and
  visibility/grant filtering.
- Added a JSON Schema, architecture docs, package docs, and focused CI.

The product doctrine and deeper discovery record were also pushed to the
global memory bank in commit `d9d5e8b`.

## Verification

- `node scripts/check-foss-tree.mjs`
  - restricted source absent;
  - FOSS startup active;
  - removed workspace packages absent;
  - all `workspace:` references resolve.
- Pinned Node 22.22.3 focused Yarn resolution completed.
- `@tinyfat/community-policy` TypeScript build passed.
- `@tinyfat/federation-community` TypeScript build passed.
- `node --test packages/tinyfat-awareness/src/*.test.mjs`
  - 6 tests passed;
  - encryption-at-rest assertion passed;
  - idempotency and conflicting-ID assertion passed;
  - 20 concurrent same-channel appends remained ordered;
  - scoped Batman-style visibility filtering passed;
  - tamper detection and traversal rejection passed.
- `git diff --check` passed before commit.
- Public `origin/main` resolved to
  `e3fa8df12e351fa7fff78af4f9943724e673e51c`.

## Deployment status

The source and commits are public at
<https://github.com/tinyfatco/business-os>. No Business OS application was
deployed, and no live Manny, Gmail, Mattermost, Slack, Sendly, or Troublemaker
route changed.

## Manual QA and next gaps

- A full Rocket.Chat monorepo install/build has not yet run; only the focused
  TinyFat packages were installed and built.
- The imported source has not yet replaced the official 8.6.0 local Docker
  evaluation image.
- The awareness store is deliberately a single-hostd-writer spike backend; a
  multi-process storage contract is not implemented.
- Customer/contact/endpoint/provider-thread identity tables are next.
- Rocket.Chat customer-room projection and hostd bridge are not implemented.
- The authorized `gog --account alex@tinyfat.com` email acceptance test must
  wait until the bridge exists.
- SMS QA must preserve every current `+1 737-330-0002` route and begin with an
  explicitly scoped test path.
