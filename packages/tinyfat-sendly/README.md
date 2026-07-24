# `@tinyfat/sendly-bridge`

Host-owned Sendly ingress and explicit SMS delivery for TinyFat customer
awareness streams.

The bridge:

- verifies timestamped `X-Sendly-Signature` HMACs before parsing a webhook;
- accepts inbound traffic only for one configured TinyFat sender;
- resolves the external phone through the encrypted customer identity graph;
- binds the provider conversation and appends the inbound message before any
  agent is woken;
- never authors or automatically sends a response;
- accepts outbound body text only from an identified human or agent;
- confirms the verified endpoint belongs to the named customer channel;
- restricts the transport to an explicit test-recipient allowlist;
- records outbound intent, provider receipt, failure, and idempotency state.

The spike transport intentionally implements only `disabled` and `test` modes.
There is no broad live mode. A production rollout must introduce a separately
reviewed route and must not repoint the existing `(737) 330-0002` Sendly
webhook.
