# TinyFat Business OS

TinyFat Business OS is a customer-relationship workspace built from the
MIT-compatible Rocket.Chat messaging substrate and powered by Troublemaker.
It treats each customer relationship as a first-class channel spanning email,
SMS, humans, agents, files, decisions, and durable work.

The canonical customer record is not the chat room or a CRM row. It is an
append-only **customer awareness stream**. Rocket.Chat projects that stream
into a collaborative workspace, hostd owns identity and provider delivery, and
Troublemaker reasons and acts inside an isolated customer context.

```text
email / SMS / Slack / workspace
              │
              v
      customer awareness stream
         │         │          │
         v         v          v
  Business OS   Troublemaker  hostd delivery
  customer room customer mind Gmail / Sendly
```

## Spike target

The first working slice is TinyFat's Websites for People workflow:

1. A test message arrives through `manny@tinyfat.com`.
2. Hostd resolves or creates a stable customer channel.
3. The inbound message is appended to the channel's awareness stream.
4. A private Business OS room projects the relationship and wakes its isolated
   Manny context.
5. Alex, Batman, Manny, and other explicitly authorized collaborators can work
   together without exposing unrelated customer context.
6. Manny explicitly sends a native-thread email reply.
7. Delivery state is appended to the same awareness stream.
8. A verified phone identity can later join that relationship through the
   existing TinyFat Sendly number.

## Architecture rules

- Troublemaker is the agent runtime and intelligence layer.
- The awareness stream is the canonical definition of the relationship.
- Business OS rooms are projections, not the identity or transport database.
- Hostd owns provider credentials, routing, identity proofs, capabilities,
  event ordering, and runtime lifecycle.
- Agents collaborate through scoped relationship grants; no agent receives an
  unbounded customer corpus by default.
- Internal collaboration stays internal unless an agent or human explicitly
  sends externally.
- Harnesses and adapters never author customer-facing fallback messages.
- Email and phone identities are never merged on fuzzy similarity.

The detailed spike contract lives in
[`docs/architecture/customer-awareness-stream.md`](docs/architecture/customer-awareness-stream.md).
The repaired community build boundary is documented in
[`docs/architecture/foss-capability-boundary.md`](docs/architecture/foss-capability-boundary.md).

## Source and licensing

This repository began as a clean-history import of the Rocket.Chat `8.6.1`
FOSS tree. Rocket.Chat's Enterprise Edition directories were removed before
the first commit. See [`UPSTREAM.md`](UPSTREAM.md), [`NOTICE.md`](NOTICE.md),
and [`LICENSE`](LICENSE).

Run the FOSS boundary check with:

```bash
node scripts/check-foss-tree.mjs
```

Rocket.Chat is a trademark of Rocket.Chat Technologies Corp. TinyFat Business
OS is an independent TinyFat project and is not endorsed by Rocket.Chat.

## Status

This is an active spike. The imported messaging platform is present; the
TinyFat customer-awareness, identity, hostd bridge, and interface work are
being implemented incrementally with tests before live Manny or Sendly routes
change.
