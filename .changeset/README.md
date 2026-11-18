# Changesets

Release notes and version bumps are driven by [Changesets](https://github.com/changesets/changesets), the same way as the rest of the `@dschz` family (see `solid-flow`).

- `pnpm pkg:changeset` — describe a change (one file per change, checked in with the PR).
- `pnpm pkg:version` — consume changesets: bump `package.json` (+ `jsr.json`), write `CHANGELOG.md`.
- `pnpm pkg:publish` — build and publish (`changeset publish` also creates the git tag).

Releases are stable and publish to `latest`. The `36.0.0-next.N` prereleases (Solid 2.0 RC era) ran in pre mode on the `next` tag; pre mode ended with `36.0.0`. To ship prereleases again (for example an AG Grid 37 port), run `pnpm exec changeset pre enter next`; `pkg:publish` then moves the `next` dist-tag to each prerelease (`scripts/sync-pre-tag.mjs`).
