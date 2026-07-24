# Verified customer identity linking

Date: 2026-07-24

## Commit

- `business-os` `61969e8` — Complete verified customer identity linking
- Pushed to `tinyfatco/business-os` `main`

## What changed

- Added non-mutating endpoint-link suggestions that return safe labels and the
  required next action without creating or moving an identity.
- Added explicit human operator approval with a required reason, encrypted
  approval evidence, and customer/verified-source checks.
- Limited verification-code guesses and permanently failed a challenge after
  its configured attempt count.
- Added merge-review decisions. Approval records
  `approved-pending-merge`; it deliberately does not move an endpoint or merge
  two customer histories.
- Added an encrypted append-only identity audit for challenge starts, failed
  attempts, verified links, operator approvals, and merge decisions.
- Added `CustomerIdentityLinkService`, which pairs identity mutations with
  immutable awareness events so the relationship stream remains canonical.
- Updated the local cross-channel script to use the service rather than
  hand-authoring identity events.

## Verification

- `node --test packages/tinyfat-awareness/src/*.test.mjs`: 6/6 passed.
- `node --test packages/tinyfat-customer-identity/src/*.test.mjs`: 11/11
  passed.
- `node --test packages/tinyfat-collaboration/src/*.test.mjs`: 2/2 passed.
- `node --test packages/tinyfat-sendly/src/*.test.mjs`: 3/3 passed.
- `node --test packages/tinyfat-rocket-projection/src/*.test.mjs`: 6/6 passed.
- `node scripts/check-foss-tree.mjs`: passed.
- `git diff --check`: passed.
- Re-ran the local-only cross-channel proof:
  - customer channel `cus_local_cross_7d85280442f5`;
  - Rocket room `6a630ffac41cf1249510e176`;
  - 12 contiguous awareness events;
  - 11 channel-visible first projections and 11 duplicate-safe replays;
  - one fake provider call, zero Sendly network calls.

## Safety notes

- Endpoint values, contact display values, operator reasons, and audit details
  remain encrypted in the identity database.
- A collision keeps its existing endpoint/contact/channel routing even after
  review approval. A future dedicated merge operation must preserve and
  reconcile both histories explicitly.
- No Rocket.Chat cloud service, live Sendly route, real customer endpoint, or
  resident agent was changed.
