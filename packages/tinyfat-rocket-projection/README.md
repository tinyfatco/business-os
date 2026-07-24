# `@tinyfat/rocket-projection`

Projects canonical customer awareness streams into private Rocket.Chat rooms.

The projector:

- creates one private room for a stable `customerChannelId`;
- stores the room binding in the host-owned identity database;
- renders allowed awareness events with actor/source provenance;
- adds namespaced TinyFat room and message metadata;
- keeps a durable projection ledger so replay is idempotent;
- does not treat a Rocket.Chat post as external email/SMS delivery;
- does not give customer runtimes a workspace-wide Rocket.Chat credential.

The bridge credential belongs to hostd. `X-Auth-Token` and `X-User-Id` are
added only inside the client and never written to awareness events or the
projection ledger.
