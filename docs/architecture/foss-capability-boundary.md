# FOSS capability boundary

Rocket.Chat's upstream `fossify.ts` removes the two restricted source trees,
but the 8.6.1 community manifests and startup graph still referenced packages
that lived in those trees. A clean checkout therefore could not complete a
Yarn resolution after fossification.

TinyFat Business OS repairs that boundary independently:

- stale dependencies on removed workspace packages are deleted;
- the commercial license integration is replaced with
  `@tinyfat/community-policy`, which activates no paid modules, limits, cloud
  licenses, or air-gapped subscription restrictions;
- the two surviving federation helpers use
  `@tinyfat/federation-community`, an independently written parser and random
  key helper that does not provide Enterprise federation services;
- the removed presence implementation and external Enterprise omnichannel
  workers are no longer registered by the community startup graph;
- the media-call server path that depended on a removed workspace package is
  removed from this spike;
- a test that imported a deleted Enterprise implementation is removed.

This is intentional product scope, not an attempt to reproduce missing paid
features. TinyFat CRM uses the Omnichannel contacts, visitors, conversations,
routing, and analytics that remain in the MIT tree. TinyFat adds its provider
adapters, awareness semantics, and verified identity evidence independently.
It does not restore or reimplement removed Enterprise source. In particular,
the Enterprise contact-verification app is not used; TinyFat's existing
challenge and operator-review service supplies verification evidence, which a
narrow community integration may reflect into the native contact channel.

`scripts/check-foss-tree.mjs` enforces:

1. restricted source directories are absent;
2. no restricted paths are tracked;
3. no removed workspace package remains in a manifest;
4. every `workspace:` dependency resolves to a present workspace;
5. the reviewed FOSS startup module is active.

The focused TinyFat packages can be installed and built without restoring any
removed source.
