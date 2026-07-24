# Omnichannel relationship model

TinyFat CRM uses Rocket.Chat Community Omnichannel as its contact-center shell
and the TinyFat awareness stream as the durable definition of a relationship.
Those systems overlap, but they are not interchangeable.

| Concept              | Owner                         | Meaning                                                                                              |
| -------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Contact              | Rocket.Chat Omnichannel       | One customer identity with email, phone, and channel associations                                    |
| Conversation         | Rocket.Chat Omnichannel       | One open or closed provider interaction, such as a Gmail thread or SMS exchange                      |
| Relationship channel | TinyFat                       | One bounded customer/project context in which humans and agents collaborate                          |
| Awareness stream     | TinyFat                       | The ordered, replayable, provenance-preserving record across every conversation and internal action  |
| Provider thread      | TinyFat hostd                 | A Gmail, Sendly, web, or other provider locus bound to one relationship and Omnichannel conversation |
| Assigned agent       | Rocket.Chat plus Troublemaker | The visible Manny identity serving that relationship                                                 |

The relationship channel must not be modeled as one immortal Omnichannel
conversation. Conversations have operational lifecycle—queued, assigned, open,
on hold, closed—and drive Rocket's contact-center reports. The awareness stream
outlives them and connects their history.

## Inbound flow

1. Hostd authenticates and journals the provider event.
2. TinyFat identity resolution finds the customer relationship and verified
   endpoint.
3. Hostd calls the authenticated TinyFat Omnichannel ingress seam.
4. Rocket attaches or creates the native contact and provider visitor, then
   opens or reuses a native Omnichannel conversation with its real source.
5. The exact human-authored inbound body is recorded as a visitor message.
6. Rocket assigns the relationship's Manny and updates its native queue,
   contact history, monitoring, and analytics.
7. Troublemaker receives the same event through the adapter-neutral customer
   collaboration protocol and the awareness stream remains canonical.

## Outbound flow

Rocket, hostd, and provider adapters never invent visible prose. Manny or a
human explicitly authors the response. Delivery goes through the provider
adapter with idempotency and receipts, then the delivered or failed fact is
appended to awareness and reflected in the native conversation.

## Internal work

Working output, tool progress, private collaboration, and operator notes are not
automatically customer-visible conversation messages. They belong in the
awareness-backed relationship work surface. The Omnichannel conversation shows
the actual external exchange; the relationship view can present both without
conflating them.

## Source and license boundary

Contacts, visitors, conversations, routing, Contact Center, analytics, and
real-time monitoring used here live outside `ee/` and `apps/meteor/ee/` in the
fossified repository. TinyFat code must not import, restore, or derive from
removed Enterprise source.
