# Native TinyFat Omnichannel ingress

**Date:** 2026-07-24  
**Commit:** `69a0caf` (`Add native TinyFat Omnichannel conversation ingress`)

## What changed

- Added authenticated `POST /api/v1/tinyfat/omnichannel/conversation` to the
  FOSS Meteor application.
- The endpoint delegates visitor, contact, room, routing, and assignment work
  to Community Omnichannel while preserving the real email, SMS, or API source.
- Verified TinyFat endpoint evidence can mark the visitor association and room
  verified. The caller must have `manage-livechat-agents`.
- Documented the separation between native contacts/conversations,
  awareness-backed relationship channels, provider threads, and assigned
  Manny identities.
- Documented Rocket.Chat as an executable workspace comparison rather than an
  assumed platform winner; Zulip should be evaluated against the same neutral
  contract.
- Repaired clean-build dependency/export gaps in `@rocket.chat/omni-core` and
  `@tinyfat/community-policy`.

## Verification

Passed locally:

- `node scripts/verify-tinyfat-spike.mjs`
- `node scripts/check-foss-tree.mjs`
- focused ESLint on the new endpoint, API import, license hook, and policy
  export
- focused Prettier check
- `git diff --check`
- `@rocket.chat/omni-core` build
- Meteor lint
- a complete Meteor production bundle at
  `/tmp/tinyfat-business-os-build.VT3IJG/bundle`

The focused spike suite verified encrypted awareness, customer identity links
and merge review, Sendly ingress/receipts, relationship collaboration, Rocket
projection, and the FOSS source boundary. No external email or SMS was sent.

## Deployment and manual QA

The production bundle was not installed into the browser-visible local Rocket
container. Docker image packaging filled the shared Colima VM, after which its
image metadata returned I/O errors. Because that same profile contains Alex's
active Zulip evaluation, it was not restarted or pruned.

Visible QA of the new Email source/verified label remains pending. The local
Rocket tab still represents the earlier stock image.

## Pause

Alex paused Rocket.Chat work after this checkpoint to focus on Zulip. Preserve
this implementation as a comparison and resume only on explicit direction.
