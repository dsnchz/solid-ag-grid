# AGENTS.md

`@dschz/solid-ag-grid` renders AG Grid entirely in Solid 2.0. It is a port of `ag-grid-react` v36: AG Grid's controllers (ctrls) drive the grid, and Solid renders every row, cell and header from what the ctrls push through `compProxy` setters. Custom components mount through portals. `rowStore` turns store mutations into grid transactions, and async grid-option props are supported.

Read `docs/field-guide/` before changing `src/`. Chapter 3 maps the code and has the table of where each rule (law) is enforced. Chapter 4 is the performance model. The user docs are `docs/reactivity.md`, `docs/row-store.md` and `docs/ssr.md`.

## Commands (pnpm)

| Command          | What it runs                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `pnpm test`      | Vitest projects `unit` (jsdom), `ssr` (node) and `browser` (real Chromium via Playwright)     |
| `pnpm test:perf` | The `perf` project, on Solid's production build. Timing output only; it is not part of `test` |
| `pnpm typecheck` | `tsc --noEmit` (TypeScript 7)                                                                 |
| `pnpm lint`      | ESLint with `eslint-plugin-solid/configs/v2-strict`                                           |
| `pnpm format`    | oxfmt (`format:check` in CI)                                                                  |
| `pnpm build`     | Vite lib build plus `.d.ts` and source (`solid` condition) emits                              |
| `pnpm dev`       | Dev playground (`dev-playground/`). It serves Solid's `/__solid/diagnostics` endpoint         |

Gate before every commit: `format:check`, `lint`, `typecheck`, `test`, `build`. Run `test:perf` for anything that touches the cell or row mount path. `check:solid` is advisory; its baseline is 20 warnings and 18 errors.

## Solid 2.0

This project uses Solid 2.0 (`solid-js` 2.x with `@solidjs/web`). Components run once; there is no re-render. Read `node_modules/solid-js/CHEATSHEET.md` before writing Solid code, especially its last section, "What changed from 1.x". When this file and the installed cheatsheet disagree, the cheatsheet wins.

Rules that matter most:

- Props are read, never destructured: `props.name` inside JSX, a memo, or an effect. `function Comp({ name })` loses reactivity. Pass values, not accessors: `<Child count={count()} />`.
- `createEffect(compute, apply)` takes two functions. The first reads reactive values and returns a result; the second receives it and performs side effects. A single argument is an error. Effects never compare compute values: the apply half runs whenever compute re-runs. Read a `createMemo` in compute to skip unchanged values.
- Stores are written through the draft: `setStore(s => { s.user.name = "Ada" })`. There are no path setters and no `produce`.
- Read reactive values inside JSX, a memo, or an effect, never at the top of a component body. The deliberate exception here is reading props once with `untrack(() => props.x)` for objects a ctrl owns for the component's whole life (the setComp verdict in `src/gridComp.tsx`).
- Do not write a signal or store from a memo, an effect's compute function, or a component body. Write from event handlers, `onSettled`, actions, or the ctrl's `compProxy` setters. A signal cleared during disposal opts in with `{ ownedWrite: true }`.

Names that no longer exist, and what to use:

- `solid-js/web` → `@solidjs/web`; `solid-js/store` → `solid-js`
- `Suspense` → `Loading`; `SuspenseList` → `Reveal`; `ErrorBoundary` → `Errored`
- `mergeProps` → `merge`; `splitProps` → `omit`; `unwrap` → `snapshot`; `onMount` → `onSettled`
- `createResource` → an async `createMemo` or `createStore(fn)` read under `<Loading>`
- `createSelector` → `createProjection`; `createComputed` → `createMemo` or a two-function `createEffect`
- `batch` → writes batch on a microtask (`flush()` applies them now); `on()` → the compute half of `createEffect`
- `startTransition` / `useTransition` → built in; `isPending()` reports an in-flight change
- `Index` → `<For keyed={false}>`; `indexArray` → `mapArray`; `createMutable` → `createStore` with draft setters
- `onError` / `catchError` → `<Errored>` or the `error` option of `createEffect`
- `classList` → `class={{ active: isActive() }}`; `use:` directives → `ref={factory(args)}`
- `Context.Provider` → `<Context value={...}>`; `equalFn` → `isEqual`; `getListener` → `getObserver`

Solid tooling installed in `node_modules`:

- **Skills:**
  - `node_modules/solid-js/skills/solid-2.0/SKILL.md`: the Solid 2.0 primer.
  - `node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`: every warning code and its fix.
  - `node_modules/@solidjs/diagnostics/skills/agent-loops/SKILL.md`: capture evidence and assert budgets.
- **Warnings are defects.** A console warning with a bracketed code, such as `[REACTIVE_WRITE_IN_OWNED_SCOPE]`, is a defect: look it up in the repair guide; do not suppress it. The one accepted warning is `CAUGHT_REACTIVE_READ` from `AgGridSolid.gridOptions`, raised while an async prop has not loaded yet (`src/core/asyncProps.ts`, solidjs/solid#4789).
- **Verifying a reactive change:**
  - in tests, use `captureArtifact` from `@solidjs/diagnostics` (see `test/browser/runtimeDiagnostics.browser.test.tsx`);
  - live, while `pnpm dev` runs, `POST /__solid/diagnostics` with `{"method":"begin","params":{"attribution":true}}` … `{"method":"end"}`.
- **Docs:** https://v2.solidjs.com/llms.txt. Append `.md` to any page URL for its Markdown. The most relevant pages here are `/guides/integrate-non-solid-code`, `/guides/lists`, `/guides/performance` and `/guides/testing`.

## Project rules

### Reactivity in `src/`

- **Values derive; lifecycles are effects.** There are only two legitimate effect kinds (field guide ch. 3, review checklist): bridge category 1 pushes reactive state into the AG Grid core; bridge category 2 is the signal-keyed lifecycle of a non-Solid instance (a JS renderer, an editor, an observer). Every new `createEffect` carries:
  - a comment naming its category;
  - a `{ name: "Component.purpose" }` option. Names appear in diagnostics and attribution, including the warnings users see.
- **Core-jurisdiction rule:** a value with a single external writer (the ctrl) and no reader in the graph is written straight to the DOM in the setter; it is not a signal. Examples: row index, top, transform, pinned lane widths, editing classes. Anything something derives from is a signal.
- **Cell and row mounts are hot paths.** They run on every row swap while scrolling.
  - Don't add a `<Show>` whose condition is a plain signal the ctrl writes. Use a reactive hole, `() => cond() ? untrack(branch) : …`, which owns and disposes what its branch creates.
  - Keep `<Show>` where the condition can read async data.
- **Budgets.** `test/unit/reactiveGraphBudget.test.tsx` pins computations and signals per cell and per row. `runtimeDiagnostics.browser.test.tsx` pins zero diagnostics and per-update re-run counts. Tighten a budget when the code gets cheaper; raise one only with a design note in `docs/field-guide/04-performance-model.md`.
- **Comments must stay true.** Comments carry law tags (`§N`, `VERDICT`, `RUN-ONCE DIVERGENCE`). A `§N` tag points at a section of the maintainer's local design doc, `.agent/planning/ARCHITECTURE.md` (gitignored); the committed rule set is field guide ch. 3. A change that invalidates a comment updates it in the same commit.

### AG Grid

- `ag-grid-community` (peer) and `ag-stack` (dependency) are pinned to exactly the same version, as `ag-grid-react` pins them. AG Grid's internals are not semver-governed.
- **Porting a new AG Grid release:** port the `ag-grid-react` diff hunk by hunk (`git diff release-A release-B -- packages/ag-grid-react/src` in a local clone under the gitignored `tmp/ag-grid-36`). Bump the pins, `jsr.json`, and the README table in the same change.
- `.github/workflows/aggrid-watch.yml` builds weekly against the newest `^36` release; when it goes red, the next port is due.
- **Behavior is checked against vanilla.** Browser tests compare Solid output with vanilla `createGrid` under the same options (the parity oracle). React-only mechanics (memo types, `flushSync`, effect timing) are translated, not copied; see ch. 3's translation table.

### Tests

- **A test must fail when the feature breaks.** Assert consumer-visible behavior: what the grid renders, what the API returns, transitions, precedence, errors.
- **Mutation-check new or strengthened tests:** break the feature in `src/`, watch the test fail for the right reason, restore.
- **Banned assertion styles:** wiring-only checks, mock echoes, `toBeTruthy` on always-truthy values, and `toEqual` on DOM nodes when identity is the claim (use `toBe`; `toEqual` compares structure).
- **Engine pins:** a pin of Solid or AG Grid behavior that the code relies on is marked `EMPIRICAL`. A known upstream regression uses `it.fails` with the upstream reference, so the test goes red when the fix ships.
- **Perf claims:** make them only from `pnpm test:perf` (production posture), as an interleaved A/B against the base on the same machine. Dev-build numbers don't count.

### Commits and releases

- **Conventional Commits** (`feat:`, `fix:`, `perf(cells):`, `test:`, `chore:`; `!` marks breaking changes). The body states what changed, why, and the evidence: measured numbers, mutation checks, the gate. Add a `Co-Authored-By:` trailer for the agent.
- **Stage paths explicitly; never `git add -A`.** Vitest browser mode writes failure attachments to `.vitest/` (gitignored), and the history was rewritten once to remove committed attachments.
- **Changesets** are in pre mode (`next` tag); entries are `patch`, written for consumers. `pkg:version` syncs `jsr.json`. Publishing is the maintainer's call.
- **Upstream first.** Do not work around a Solid or AG Grid regression in library code. File it with a headless, signals-only (or vanilla-grid) repro, verified to reproduce, then pin it in a test.

## Local-only context

- `tmp/` (gitignored) holds reference clones: `tmp/ag-grid-36` (AG Grid at the ported release tags) and `tmp/solid` (the Solid monorepo, for bisecting and building `next`). Field guide ch. 1 describes how to recreate them.
- `.agent/planning/STATUS.md` (gitignored) is the maintainer's running log of decisions, measurements and next steps, if present on this machine. Read its latest dated section before starting work.
