# TinyFat Business OS spike runbook

## What Rocket.Chat already gives us

Rocket.Chat already contains most of the operator shell that made the original
idea sound much larger than it needs to be:

| Upstream Rocket.Chat | TinyFat addition |
| --- | --- |
| Users, roles, permissions, private rooms, threads, message history, search, files, and realtime delivery | One opaque customer channel per bounded relationship |
| Omnichannel navigation, contacts, agent/manager roles, queues, departments, analytics, reports, and real-time monitoring | The append-only encrypted awareness stream as the canonical relationship |
| Livechat and an app/webhook extension surface for external channels | Host-owned Gmail and Sendly identity, routing, signature verification, delivery, and receipts |
| Room membership and human collaboration | Expiring relationship-scoped Batman/Manny grants with no global customer listing |
| A strong existing operations UI | Isolated Troublemaker context and explicit agent-authored sends |

The `/omnichannel/realtime-monitoring` page is upstream Rocket.Chat code. The
FOSS import contains its route and React page at
`apps/meteor/client/views/omnichannel/realTimeMonitoring/`, its permission, and
the livechat analytics REST implementation. TinyFat did not build the page.

It does not yet monitor TinyFat customer awareness streams. Rocket.Chat's page
queries its own Livechat/Omnichannel analytics, while the current TinyFat
projector creates private customer rooms. Reusing the charts means adding an
awareness-backed analytics adapter or deliberately representing customer
channels as Omnichannel rooms; it does not mean making Rocket.Chat message
storage canonical.

Rocket.Chat's current documentation confirms the broader shell:

- [Omnichannel overview](https://docs.rocket.chat/omnichannel)
- [Real-time monitoring](https://docs.rocket.chat/docs/real-time-monitoring)
- [Omnichannel contact center](https://docs.rocket.chat/docs/omnichannel-contact-center)
- [Omnichannel apps, including SMS integrations](https://docs.rocket.chat/docs/omnichannel-apps)

Two upstream boundaries matter:

- Rocket.Chat's email inbox feature is documented as deprecated, so the spike
  keeps Gmail thread ownership in hostd rather than adopting that inbox as the
  durable transport.
- Trusted contact verification and its Verify Chat app require a paid
  Enterprise add-on. The public TinyFat repo independently implements exact
  endpoint proofs, attempt limits, operator approval, and merge review.

## Source and legal boundary

`tinyfatco/business-os` is a public, clean-history import of the Rocket.Chat
`8.6.1` FOSS tree, not a GitHub network fork. That was a deliberate legal
choice: the upstream mixed-license history was not copied, the Enterprise
trees were removed before the root commit, and a guard rejects their return.

The exact upstream tag, peeled commit, import commit, removed paths, and refresh
rule are in [`UPSTREAM.md`](../UPSTREAM.md). Attribution is in
[`NOTICE.md`](../NOTICE.md). Verify the boundary with:

```bash
node scripts/check-foss-tree.mjs
```

Do not copy implementation from removed Enterprise directories. Similar
features must come from TinyFat requirements and independently authored code.

## Architecture

```text
Gmail / signed Sendly / Slack / Rocket room
                    │
                    v
       host-owned identity and routing
                    │
                    v
      encrypted customer awareness stream
          │                 │
          v                 v
 self-managed Rocket   isolated Troublemaker
  customer room          customer Manny
          ^                 │
          │                 v
   internal work     explicit Gmail/SMS tool
                    │
                    v
          provider receipt returns to stream
```

The awareness stream owns ordering, idempotency, provenance, visibility, and
replay. Rocket rooms, Slack threads, Gmail threads, Sendly conversations, and
agent workspaces are projections or contributors.

Hostd owns provider and workspace credentials. A child Troublemaker receives
only a capability for its one context, one Rocket room, and one contact's
provider threads. Adapters never invent customer-facing prose.

## Focused verification

Use Node `22.5` or newer. The focused TinyFat packages use only repository
source and Node built-ins:

```bash
node scripts/verify-tinyfat-spike.mjs
```

That command verifies:

- encrypted ordered awareness append, replay, visibility, and tamper detection;
- exact encrypted identity resolution, challenge and operator-approved links,
  attempt limits, collision review, and awareness audit;
- relationship-scoped Batman/Manny access, expiry, and revocation;
- signed Sendly ingress, no automatic reply, allowlisted explicit delivery,
  provider-receipt recovery, and idempotency;
- Rocket private-room creation, visibility filtering, projection replay, and
  credential redaction;
- the FOSS source boundary.

## Self-managed Rocket integration

Provide a self-managed Rocket.Chat workspace reachable only from the local
machine or trusted host. Do not register it with Rocket.Chat Cloud for this
spike. Create a local admin personal access token and export:

```bash
export ROCKETCHAT_URL=http://127.0.0.1:3100
export ROCKETCHAT_USER_ID=replace-with-local-user-id
export ROCKETCHAT_AUTH_TOKEN=replace-with-local-token
```

Never commit those values. The local TinyFat evaluation keeps them in a
mode-`0600` file outside the repository.

Run the full cross-channel fixture:

```bash
TINYFAT_VERIFY_ROCKET=1 node scripts/verify-tinyfat-spike.mjs
```

The integration run:

1. creates a new fake customer relationship;
2. records an email event;
3. challenge-links a reserved fake phone identity;
4. verifies a timestamped Sendly webhook for configured sender
   `+17373300002`;
5. proves inbound SMS causes no outbound delivery;
6. gives Batman a short-lived grant for only that relationship;
7. lets Manny read Batman's handoff and append his own decision;
8. records Manny's explicit SMS intent;
9. calls an injected fake provider exactly once;
10. records the fake receipt;
11. projects the visibility-allowed awareness history into one private room;
12. replays the complete stream without duplicate posts.

The script makes no Sendly network request, changes no webhook, and sends no
real SMS.

## Troublemaker hostd integration

The agent/runtime bridge lives on the pushed Troublemaker branch
`codex/troublemaker-business-os-20260723`.

Important commits:

- `4f1902d` — hostd Rocket.Chat customer-room projection;
- `85be18d` — host DDP ingress, scoped room proxy, and
  `rocket-chat:webhook` adapter;
- `4879c1b` — Docker/Podman runtime support and host-only Rocket credential
  configuration.

The bridge subscribes once at the host, journals a human room message before
waking its context, and gives the runtime only bound-room read/append
capabilities. The runtime never receives the local admin token.

The native Gmail proof used `gog --account alex@tinyfat.com` to send one
authorized message to `manny@tinyfat.com`. Hostd projected the inbound email,
Manny explicitly used Gmail search/read/draft/send, hostd recorded the provider
receipt, and Manny reported completion in the originating Rocket thread.
Personal Gmail, Rocket.Chat Cloud, and Sendly were not used.

## Acceptance evidence

| Requirement | Evidence |
| --- | --- |
| Awareness is canonical | Encrypted JSONL stream, strict per-customer sequence, hash chain, replay tests |
| No cross-customer leakage | Identity, collaboration-grant, Rocket proxy, Gmail scope, and Sendly scope tests |
| External text is agent/human-authored | Gmail tools-only boundary and `sendAgentAuthored`; inbound Sendly test asserts zero outbound |
| Email native thread | Live Manny Gmail proof with host receipt and Rocket projection |
| Email and phone can be one relationship | Verified link service plus signed SMS fixture resolves to the email customer channel |
| Batman can help through Manny | Scoped Slack Batman event is visible to the same channel's Manny; another customer is denied |
| Delivery is replayable/idempotent | Gmail request ledger, Sendly delivery ledger, Rocket projection ledger, full replay |
| Runtime restart preserves relationship | Live email proof replaced the Docker runtime version between turns and continued the same context and awareness sequence |
| Existing routes stay intact | No resident adapter, Sendly webhook, sender row, or Crawdad route changed |

## Known gaps before production

- The clean Business OS packages and Troublemaker hostd prototype still use
  separate spike stores. They need one production host service and migration
  strategy.
- Rocket's upstream real-time monitoring charts do not yet query awareness
  events.
- The Sendly transport has no broad live mode, by design. A controlled
  recipient and separately reviewed route are required for live QA.
- Batman's live Slack resident has not been given these grants yet.
- The first Gmail QA thread contains one earlier unledgered Manny reply in
  addition to the fully traced send. Its Google API origin must be explained
  before production email rollout.
- Contact/channel merge approval intentionally stops at
  `approved-pending-merge`; a history-preserving merge executor and review UI
  remain.
- Production work still needs operator UI, secret rotation, backups, database
  migrations, retention policy, metrics, and deployment automation.

These are productionization gaps, not missing proof of the core relationship
model.
