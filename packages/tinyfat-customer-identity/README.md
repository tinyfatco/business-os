# `@tinyfat/customer-identity`

Host-owned identity and relationship primitives for TinyFat Business OS.

The store keeps these concepts separate:

- customer channel: a bounded customer relationship or project;
- contact: a person or organization participating in relationships;
- endpoint: one verified or observed email address or phone number;
- provider thread: a Gmail or Sendly transport locus bound to one customer
  channel;
- Rocket.Chat room: a projection binding, never the customer identity;
- merge review: an explicit hold when a verified endpoint already belongs to
  another contact or relationship.

Endpoint and contact values are AES-256-GCM encrypted. HMAC indexes support
exact lookup without storing raw email addresses or phone numbers. Provider
threads use the same encrypted-value/HMAC-index pattern.

Resolution fails closed:

1. A provider-thread binding wins only when the current sender is a participant
   in that customer channel.
2. A unique endpoint relationship can resolve an unbound thread.
3. Multiple candidate relationships are `ambiguous`.
4. Unknown, unassigned, and unexpected participants are not silently routed.

Link challenges prove control of a claimed endpoint. Verification attaches a
new endpoint to the source contact, but it never merges two existing contacts
or customer channels. Those collisions create a merge review.

This spike uses Node's built-in SQLite API, matching the existing hostd
prototype. Hostd remains the intended single writer.
