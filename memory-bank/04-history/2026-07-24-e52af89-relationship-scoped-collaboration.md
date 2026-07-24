# Relationship-scoped agent collaboration

Date: 2026-07-24

## Commit

- `business-os` `e52af89` — Add relationship-scoped agent collaboration
- Pushed to `tinyfatco/business-os` `main`

## What changed

- Added `@tinyfat/relationship-collaboration`, a host-owned SQLite grant store
  and awareness collaboration service.
- Grants bind one human or agent to one customer channel, one purpose, an
  explicit visibility set, explicit actions, and a short expiration.
- The bearer is returned only at issue time. The database stores an HMAC lookup
  value, not the bearer.
- The service deliberately exposes no customer-channel listing operation.
- Grant issuance, revocation, Batman contributions, and Manny contributions
  retain separate actor and surface provenance in the canonical awareness
  stream.
- Added the package to focused CI and updated architecture/status docs.

## Verification

- `node --test packages/tinyfat-awareness/src/*.test.mjs`: 6/6 passed.
- `node --test packages/tinyfat-customer-identity/src/*.test.mjs`: 6/6 passed.
- `node --test packages/tinyfat-collaboration/src/*.test.mjs`: 2/2 passed.
- `node --test packages/tinyfat-rocket-projection/src/*.test.mjs`: 6/6 passed.
- `node scripts/check-foss-tree.mjs`: passed.
- `git diff --check`: passed.
- The collaboration test proves that Batman can read and append to one
  customer, cannot use that grant against another customer, can hand channel
  context to Manny with both agents' provenance intact, and loses access after
  revocation or expiration.

## Deployment and QA

- This is a public source/contract spike, not a Batman resident deployment.
- No Slack app, resident agent, customer traffic, Gmail, Sendly route, or
  external message was changed.
- Live Batman-to-Manny Slack UX remains a later controlled integration on top
  of this grant boundary.
