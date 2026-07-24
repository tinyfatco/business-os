# Customer awareness stream

## Definition

A customer channel is TinyFat's durable operating context for one bounded
customer relationship or project. Its awareness stream is the canonical,
append-only account of that relationship.

The stream is more than message history. It records:

- external email and SMS messages;
- internal human and agent collaboration;
- contacts, endpoints, verification evidence, and relationship edges;
- agent actions and tool results;
- files, websites, proposals, and other artifacts;
- decisions, commitments, follow-ups, and relationship state;
- outbound delivery requests, receipts, failures, and retries;
- durable summaries derived from earlier events.

Rocket.Chat rooms, Slack threads, Gmail threads, Sendly conversations, and
Troublemaker context are projections or contributors. None is the canonical
relationship by itself.

## Core invariants

1. Every customer channel has an opaque, stable `customerChannelId`.
2. Events are immutable and strictly ordered within that customer channel.
3. A producer-supplied `eventId` makes ingestion idempotent.
4. Corrections append a new event referring to the superseded event; history is
   never silently rewritten.
5. Every event identifies the actor, source surface, source reference,
   visibility, time of occurrence, and time of recording.
6. External delivery is represented as intent plus receipt or failure. A room
   message alone is never proof that a customer was contacted.
7. Internal collaboration is not externally visible unless an authorized human
   or agent explicitly requests delivery through a provider tool.
8. Contact, endpoint, provider thread, customer channel, and room are separate
   identities.
9. Email and phone endpoints are linked only by trusted operator action or a
   completed verification challenge—not fuzzy matching.
10. Projections can be deleted and rebuilt from the awareness stream.
11. Agent access is granted per relationship and purpose; no collaborator gains
    an unbounded customer corpus by default.
12. Harnesses, adapters, and projections do not author customer-facing prose.

## Event envelope

The first schema is intentionally independent of Rocket.Chat, Gmail, Sendly,
Slack, and a particular database.

```json
{
  "schema": 1,
  "eventId": "evt_01J...",
  "customerChannelId": "cus_01J...",
  "sequence": 42,
  "eventType": "message.inbound.recorded",
  "occurredAt": "2026-07-23T22:18:00.000Z",
  "recordedAt": "2026-07-23T22:18:01.130Z",
  "actor": {
    "kind": "contact",
    "id": "con_01J...",
    "display": "A Customer"
  },
  "source": {
    "surface": "email",
    "ref": "gmail-thread:opaque-provider-reference"
  },
  "visibility": {
    "class": "channel",
    "grants": []
  },
  "causationId": null,
  "correlationId": "turn_01J...",
  "payload": {
    "endpointId": "end_01J...",
    "providerThreadId": "pth_01J...",
    "body": "Can you help with our website?"
  }
}
```

Provider references in model-facing projections should be opaque. Raw phone
numbers, unrestricted provider tokens, and workspace-wide credentials do not
belong in general event payloads.

## Actor provenance

An actor is one of:

- `contact`: an external person or organization participant;
- `human`: Alex or another authorized TinyFat collaborator;
- `agent`: Manny, Batman, or another named agent;
- `system`: a transport, projector, scheduler, or verifier recording facts.

An actor ID describes who caused the event. The source surface describes where
it entered. Those are deliberately different:

- Alex asking Batman in Slack is `human:alex` from `slack`.
- Batman appending research is `agent:batman` from `slack`.
- Manny requesting a Gmail reply is `agent:manny` from `troublemaker`.
- Hostd recording the Gmail receipt is `system:hostd` from `email`.

This lets the relationship retain collaboration provenance without pretending
every contribution came from one generic bot.

## Visibility

Initial visibility classes:

- `customer`: approved for delivery to one or more named external endpoints;
- `channel`: visible to normal members of the customer channel;
- `restricted`: visible only to explicit human or agent grants;
- `private`: retained for the producing principal and not projected elsewhere.

Visibility is not the same as delivery. A `customer`-class draft remains
internal until a separate authorized delivery request is recorded and executed.

## Initial event families

| Family | Examples | Purpose |
| --- | --- | --- |
| Relationship | `relationship.created`, `relationship.status.changed` | Define the customer context |
| Identity | `endpoint.observed`, `endpoint.challenge.started`, `endpoint.verified`, `endpoint.linked` | Preserve identity evidence |
| Message | `message.inbound.recorded`, `message.outbound.requested`, `message.outbound.delivered`, `message.outbound.failed` | Cross-channel communications |
| Collaboration | `collaboration.message.recorded`, `collaboration.grant.created`, `collaboration.grant.expired` | Human and multi-agent work |
| Agent | `agent.turn.requested`, `agent.action.requested`, `agent.action.completed`, `agent.action.failed` | Explain agent behavior |
| Artifact | `artifact.created`, `artifact.revised`, `artifact.published` | Websites, files, proposals, and deliverables |
| Decision | `decision.recorded`, `commitment.recorded`, `followup.scheduled` | Durable relationship meaning |
| Projection | `projection.applied`, `projection.failed` | Rebuildable Rocket.Chat and Slack views |
| Summary | `summary.recorded`, `relationship.state.derived` | Compact replay aids with source ranges |

Event names describe recorded facts. They do not command an adapter to invent
visible text.

## Multi-relationship collaboration

The system preserves independent edges:

```text
Alex ──works through──> Batman
Batman ──collaborates with──> customer Manny
Manny ──serves──> customer channel
contact ──participates in──> customer channel
email endpoint ──belongs to──> contact
phone endpoint ──belongs to──> contact
```

Batman is an operator-side doorway into the Manny fleet. A Slack interaction
may resolve a customer channel and create a short-lived grant describing:

- the customer channel;
- allowed event visibility classes;
- allowed tools or actions;
- the human principal on whose behalf Batman acts;
- expiration and revocation;
- the reason or task correlation.

Batman can then read the permitted awareness range, collaborate with that
channel's Manny, and append results. The stream retains each human and agent
actor separately.

## Projections

### Business OS room

A private Rocket.Chat room is bound to `customerChannelId`. A projector renders
external messages, internal collaboration, agent work, artifacts, and delivery
state using namespaced TinyFat message metadata. Replaying the stream must
reconstruct the meaningful room state.

### Troublemaker

A customer Manny receives a visibility-filtered awareness slice plus durable
workspace state. Turns append agent intent and tool outcomes back into the
stream. The runtime does not receive provider credentials or a workspace-wide
Rocket.Chat token.

### Slack and Batman

Slack remains a dynamic collaboration surface. Batman obtains a scoped
relationship grant, not a global mirror. Relevant results are appended to the
customer stream and projected back to the customer room.

### Email and SMS

Hostd resolves provider events to customer channels and records them before
waking agents. Outbound provider tools accept opaque endpoint or thread IDs.
Provider receipts are recorded before a projection claims delivery.

## First vertical-slice acceptance test

1. Send a test email using `gog --account alex@tinyfat.com` to
   `manny@tinyfat.com`.
2. Resolve or create one customer channel and append the inbound event.
3. Create one private Business OS room carrying that opaque channel ID.
4. Project the email into the room and wake one isolated Manny.
5. Collaborate internally without leaking the message to another channel.
6. Have Manny explicitly request a native-thread reply.
7. Send through the host-owned Gmail integration.
8. Record the provider receipt and project the delivery state.
9. Replay the stream into an empty projection and obtain the same meaningful
   customer history.

SMS identity linking and Batman-from-Slack collaboration extend this slice
without changing which record is canonical.
