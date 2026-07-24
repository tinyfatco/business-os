# `@tinyfat/relationship-collaboration`

Host-owned, relationship-scoped grants for collaboration between humans and
agents.

A grant names exactly one customer channel, one subject, an allowed awareness
visibility set, an allowed action set, a purpose, and an expiration. The
one-time bearer value is returned only when the grant is issued; SQLite stores
an HMAC lookup value, never the bearer itself.

The collaboration service has no customer-channel listing operation. A caller
must present both the opaque channel ID and its matching grant. This is the
boundary that lets Batman enter one customer relationship from Slack without
receiving a global CRM corpus.

Grant issuance, expiration or revocation, Batman contributions, and Manny
responses are appended to the same customer awareness stream with distinct
human and agent provenance.
