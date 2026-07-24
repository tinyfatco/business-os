# Upstream provenance

TinyFat Business OS derives from the open-source portions of Rocket.Chat.

- Upstream repository: <https://github.com/RocketChat/Rocket.Chat>
- Release: `8.6.1`
- Annotated tag object: `2c9d21432b6cfa9bac40a231ad38159e0a7dfeb9`
- Peeled release commit: `bfd782302d20cbd672c785ac8c0d072d7cc6b0db`
- Import date: 2026-07-23
- Import commit: `8d36c0b5a7e717456391bd5f9bf65494700ee0f8`

The source was checked out at the release commit and transformed with
Rocket.Chat's `scripts/fossify.ts`. That process removed:

- `ee/`
- `apps/meteor/ee/`

It also replaced the normal startup module with the upstream FOSS startup
module. The fossify script received a mechanical compatibility update from
deprecated `fs.rmdir(..., { recursive: true })` to
`fs.rm(..., { recursive: true })` so it runs on current Node versions.

The repository was then committed on a new root branch. Upstream's mixed-license
Git history is intentionally not part of this repository's history. The
`upstream` Git remote remains available locally for deliberate future imports.
Every upstream refresh must repeat the FOSS transformation and pass
`node scripts/check-foss-tree.mjs` before it can be committed.

Do not copy, restore, or reimplement source from the removed Enterprise Edition
trees. Similar product concepts must be implemented independently from the
documented TinyFat requirements.
