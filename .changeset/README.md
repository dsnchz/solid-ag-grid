# Changesets

Release notes and version bumps are driven by [Changesets](https://github.com/changesets/changesets), the same way as the rest of the `@dschz` family (see `solid-flow`).

- `pnpm pkg:changeset` — describe a change (one file per change, checked in with the PR).
- `pnpm pkg:version` — consume changesets: bump `package.json` (+ `jsr.json`), write `CHANGELOG.md`.
- `pnpm pkg:publish` — build and publish (`changeset publish` also creates the git tag).

The package is in **pre-release mode** on the `next` tag (`.changeset/pre.json`) while Solid 2.0 is an RC: every version bump yields the next `36.0.0-next.N`, published under `--tag next`. Leave pre mode with `pnpm exec changeset pre exit` when Solid 2.0 goes stable and `36.0.0` ships.
