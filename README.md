# TinyFat Business OS

TinyFat Business OS is a customer-relationship workspace built from the
MIT-compatible Rocket.Chat messaging substrate and powered by Troublemaker.
It treats each customer relationship as a first-class channel spanning email,
SMS, humans, agents, files, decisions, and durable work.

The canonical customer record is not the chat room or a CRM row. It is an
append-only **customer awareness stream**. Rocket.Chat projects that stream
into a collaborative workspace, hostd owns identity and provider delivery, and
Troublemaker reasons and acts inside an isolated customer context.

TinyFat Business OS is self-managed. Its setup flow does not create or require
a Rocket.Chat Cloud registration.

```text
email / SMS
    │
    v
hostd identity + journal
    │               │
    v               v
Omnichannel       awareness stream
conversation        relationship truth
    │               │
    └───────┬───────┘
            v
 Business OS relationship work
 humans + Manny + scoped agents
```

## Spike target

The first working slice is TinyFat's Websites for People workflow:

1. A test message arrives through `manny@tinyfat.com`.
2. Hostd resolves or creates a stable customer channel.
3. The inbound message is appended to the channel's awareness stream.
4. A native Omnichannel conversation represents the external interaction, and
   an internal Business OS work surface wakes its isolated Manny context.
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
- Omnichannel contacts identify customers; Omnichannel conversations model
  individual external interactions, not the whole relationship.
- Mattermost and Rocket.Chat share one adapter-neutral customer collaboration
  protocol; workspace adapters supply only transport primitives.
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
The reproducible verification and ownership boundary are in
[`docs/spike-runbook.md`](docs/spike-runbook.md).
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

With a local Rocket.Chat API credential in the environment, create and project
the contained demo relationship with:

```bash
node scripts/spike-local-customer-channel.mjs
```

The fuller local-only replay links a fake verified phone to the email
relationship, ingests a signed Sendly fixture for the configured
`(737) 330-0002` sender, performs scoped Batman/Manny collaboration, records an
agent-authored fake SMS receipt, and projects the one stream twice:

```bash
node scripts/spike-local-cross-channel.mjs
```

That script injects its own fake `fetch` implementation. It makes no Sendly
network request and does not create, replace, or repoint a webhook.

Run every focused proof, and optionally the self-managed Rocket integration,
with:

```bash
node scripts/verify-tinyfat-spike.mjs
TINYFAT_VERIFY_ROCKET=1 node scripts/verify-tinyfat-spike.mjs
```

Rocket.Chat is a trademark of Rocket.Chat Technologies Corp. TinyFat Business
OS is an independent TinyFat project and is not endorsed by Rocket.Chat.

## Status

This is a working spike. The imported messaging platform, awareness stream,
identity graph, relationship-scoped collaboration grants, Rocket.Chat
projector, and Troublemaker hostd bridge are present. Native Gmail has completed
one end-to-end local customer-channel proof. Signed Sendly ingress, verified
email/phone linking, scoped Batman/Manny work, agent-authored fake delivery,
and complete Rocket replay have passed locally without touching live routes.
