# Safe Sendly cross-channel spike

Date: 2026-07-24

## Commit

- `business-os` `ab24fa7` — Add safe Sendly cross-channel spike
- Pushed to `tinyfatco/business-os` `main`

## What changed

- Added `@tinyfat/sendly-bridge` with timestamped HMAC webhook verification,
  configured-sender matching, encrypted identity resolution, provider-thread
  binding, awareness ingestion, explicit agent-authored delivery, and a
  durable idempotency/receipt ledger.
- The transport supports only `disabled` and allowlisted `test` modes. It has
  no broad live mode.
- Added a host-only identity method that releases a verified endpoint value
  only after proving it belongs to the named customer channel.
- Added `scripts/spike-local-cross-channel.mjs`, which creates one fake
  customer relationship spanning email, a challenge-linked phone, signed
  Sendly ingress, scoped Batman/Manny collaboration, an agent-authored fake SMS
  receipt, and Rocket.Chat projection/replay.
- Added focused CI coverage and architecture/runbook documentation.

## Verification

- `node --test packages/tinyfat-awareness/src/*.test.mjs`: 6/6 passed.
- `node --test packages/tinyfat-customer-identity/src/*.test.mjs`: 7/7 passed.
- `node --test packages/tinyfat-collaboration/src/*.test.mjs`: 2/2 passed.
- `node --test packages/tinyfat-sendly/src/*.test.mjs`: 3/3 passed.
- `node --test packages/tinyfat-rocket-projection/src/*.test.mjs`: 6/6 passed.
- `node scripts/check-foss-tree.mjs`: passed.
- `git diff --check`: passed.

## Local integration proof

- Ran the cross-channel script against the self-managed localhost
  Rocket.Chat.
- It created customer channel `cus_local_cross_958594389450` and private room
  `6a630df6c41cf1249510e174`.
- The canonical stream contains 12 contiguous events spanning `email`, `sms`,
  `slack`, `troublemaker`, `hostd`, and `rocket-chat`.
- The configured sender was `+17373300002`; the customer fixture used reserved
  fake number `+15125550199`.
- Signed inbound SMS appended once and generated zero outbound calls.
- Manny's explicit SMS intent generated exactly one call to the injected fake
  fetch implementation and one fake provider receipt.
- First projection posted all 12 events. A second complete replay recognized
  all 12 as existing and posted no duplicates.

## Deployment and safety

- No request reached Sendly. The integration script injects its own fake fetch.
- No real phone received a message.
- The existing `(737) 330-0002` webhook, route records, Sendly key, resident
  agent, Crawdad worker, and customer traffic were not inspected or changed.
- A controlled live recipient and separately reviewed route are still required
  before live SMS QA.
