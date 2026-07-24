# Self-managed awareness-backed customer room

**Date:** 2026-07-23
**Commit:** `05e6c21`

## Shipped

- Added `@tinyfat/rocket-projection`, a host-owned bridge from canonical
  customer awareness streams to private Rocket.Chat rooms.
- Added stable room bindings, deterministic room names, namespaced TinyFat room
  and message metadata, provenance-preserving event formatting, and a durable
  SQLite projection ledger.
- Kept projection visibility-scoped: restricted Batman collaboration is
  projected only when its explicit relationship grant is present.
- Made replay idempotent and delayed ledger writes until Rocket.Chat confirms a
  message.
- Added a contained local spike script that creates one encrypted customer
  identity graph, awareness stream, private room, email event, and scoped
  Batman collaboration note.
- Made TinyFat Business OS self-managed by skipping the Rocket.Chat Cloud
  registration step and disabling the startup behavior that would force it
  again.
- Enabled and constrained message custom fields to the namespaced `tinyfat`
  provenance schema.
- Added the projector to focused CI and documented the local workflow.
- Corrected the next implementation scope after source inspection:
  Rocket.Chat Community Omnichannel already supplies contacts, channel
  associations, verification state, conflict review, rooms, email threads,
  routing, departments, agents, and analytics. These should be reused as
  operational projections rather than rebuilt in parallel.

## Verification

- Ran all focused tests with Node 22.22.3:
  - 6 awareness tests passed;
  - 6 customer identity tests passed;
  - 6 Rocket.Chat projection tests passed.
- Both TinyFat community TypeScript packages built successfully.
- The FOSS boundary check passed and now also verifies that setup is
  self-managed.
- Prettier checks for the changed setup, projector, script, workflow, and
  package files passed.
- `git diff --check` and the local spike script syntax check passed.
- A live local Rocket.Chat 8.6.0 instance accepted:
  - private room `6a62f94098b9bfb1330d8e45`;
  - customer channel `cus_tinyfat_websites_spike`;
  - 3 awareness-backed messages with room/message metadata;
  - a second replay with all 3 ledger entries recognized and no duplicate
    messages.
- Live REST inspection confirmed the room is private, carries the stable TinyFat
  customer-channel metadata, and contains ordered email, relationship, and
  restricted Slack/Batman provenance.
- Local settings inspection confirmed:
  - no Rocket.Chat Cloud client ID;
  - no Rocket.Chat Cloud client secret;
  - `Register_Server` remains false;
  - privacy-terms consent remains false.

## Deployment status

The working integration uses the isolated localhost-only Rocket.Chat evaluation
at `127.0.0.1:3100`. Its API credential and encrypted spike state live outside
the repository with restricted filesystem permissions. No live Manny, Gmail,
Slack, Mattermost, Sendly, or Troublemaker route changed.

## Manual QA and next gaps

- The visible local server is still the official Rocket.Chat evaluation image,
  not a build of the TinyFat source fork.
- The full Rocket.Chat UI typecheck still requires the upstream generated and
  internally built workspace dependency chain. Focused attempts stop on
  unresolved upstream workspace packages and existing test type globals; no
  errors specific to the changed setup fields were isolated.
- The private-room projector proves the awareness contract, but the next bridge
  should map native Community Omnichannel contacts, rooms, and routing onto the
  same `customerChannelId` rather than introducing a parallel contact center.
- Hostd ingress, a real Manny wake, native Gmail thread delivery, and the
  authorized `gog --account alex@tinyfat.com` test remain unimplemented.
- Sendly and `+1 737-330-0002` remain untouched until a contained route and
  rollback plan exist.
