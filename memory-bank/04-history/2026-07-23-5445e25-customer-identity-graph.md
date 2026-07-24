# Encrypted customer identity graph

**Date:** 2026-07-23
**Commit:** `5445e25`

## Shipped

- Added stable customer channels independent of Rocket.Chat rooms and provider
  threads.
- Added encrypted contacts and email/phone endpoints with exact HMAC lookup.
- Added many-to-many contact participation in customer relationships.
- Added encrypted native provider-thread bindings.
- Added deterministic inbound resolution:
  - a known thread resolves only for a channel participant;
  - an unexpected participant is quarantined;
  - one active relationship resolves;
  - multiple active relationships remain ambiguous;
  - unknown and unassigned endpoints fail closed.
- Added challenge-based email/phone linking from a verified source endpoint.
- Added explicit merge-review creation when a verified claimed endpoint already
  belongs to another contact.
- Added Rocket.Chat room binding storage without making the room the customer
  identity.
- Added focused CI and architecture documentation for the package.

## Verification

- Ran under the repository-pinned Node 22.22.3.
- `node --test packages/tinyfat-customer-identity/src/*.test.mjs`
  - 6 tests passed;
  - raw endpoint/contact values absent from the closed SQLite file;
  - normalized endpoint deduplication passed;
  - unique and native-thread resolution passed;
  - unexpected participant quarantine passed;
  - multi-channel ambiguity passed;
  - verified phone linking passed;
  - existing-relationship collision produced merge review without moving the
    endpoint.
- Awareness package tests remained at 6 passing.
- TinyFat community TypeScript packages built successfully.
- FOSS boundary and `git diff --check` passed.
- Public `origin/main` advanced to
  `5445e25`.

## Deployment status

The package is public in `tinyfatco/business-os`. It has not been connected to
the local Rocket.Chat evaluation, hostd, Gmail, Sendly, or any live route.

## Next gaps

- Identity operations must append their facts to the canonical awareness
  stream through a durable outbox.
- Rocket.Chat customer-room provisioning and event projection are next.
- Merge review has safe pending state but no approval/execution operation yet.
- The real provider bridge must pass opaque endpoint IDs to agents and reserve
  raw values for host-owned delivery.
