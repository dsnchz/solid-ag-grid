# Chapter 3 — Anatomy of the port (the maintainer's map)

Chapters 1–2 taught the engine and the timing model. This chapter is the map of
the codebase itself: what lives where, where every law is enforced, and how to
review a change — yours or an agent's — without re-deriving the whole design.

## The module map

```
src/
├── index.tsx                  public surface (1:1 with ag-grid-react + Solid extras)
├── agGridSolid.tsx            ENTRY: types, component wiring, prop-diff effect, JSX
├── agGridProvider.tsx         optional modules/license contexts (accessor-carrying)
│
├── core/                      the bridge layer (no rendering)
│   ├── asyncProps.ts          per-key isolation pipeline (Q9): snapshot + diff
│   ├── readyQueue.ts          ready/queue state machine (plain mutables, on purpose)
│   ├── gridBoot.ts            straight-line boot: license, create, whenReady wiring
│   ├── solidFrameworkOverrides.ts   refresh lock, ensureVisible latch, comp map
│   ├── solidFrameworkComponentWrapper.ts  user-comp factory (createWrapper switch)
│   ├── solidComponent.ts      the bridge object the core holds for a user comp
│   ├── portalManager.ts       portal registry (identity-preserving, props signal)
│   ├── gridPortals.tsx        the <For>/<Portal> render loop
│   ├── utils.ts               agFlush + runWithoutFlush latch, CssClasses
│   ├── jsComp.ts              mounts JS (non-Solid) user comps
│   ├── beansContext.ts        BeanCollection context (default-less: throws)
│   └── renderStatusService.ts "has the framework painted yet?" (core asks)
│
├── gridComp.tsx / tabGuardComp.tsx / gridBodyComp.tsx    the shell
├── rows/        rowContainerComp, rowComp (lanes, full-width, ordered diffing)
├── cells/       cellComp, editors, createJsCellRenderer, skeleton, interfaces
├── header/      grid/rows/row/cell/groupCell/filterCell comps
├── cellRenderer/ groupCellRenderer, detailCellRenderer (nested grid)
└── customComp/  the 14 reactive wrappers + hooks + CustomContext
```

Rendering flows DOWN the right column; the left column (core/) is the bridge
both directions. Nothing in `core/` renders; nothing in the comp tree talks to
the grid core except through its ctrl and the bridge.

## Where every law is enforced (and proven)

| Law (ch. 2)                                                                  | Lives in                                                         | Proven by                                                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| setComp in refs; refs write-ok / read-stale                                  | `gridComp.tsx` verdict block                                     | `test/unit/setCompScopes.test.tsx`                                      |
| Guarded `setup()` (refs run parent-first)                                    | `tabGuardComp`, `rowContainerComp`, header comps                 | header/row browser suites                                               |
| `flush()` safe; latch is hygiene                                             | `core/utils.ts` verdict on `agFlush`                             | `test/unit/flushSemantics.test.tsx`                                     |
| `ownedWrite` on disposal-cleared bridge signals                              | `cells/` (`gui`, `toolWidgets`, `jsEditorComp`), portals signal  | dev-mode-clean browser suites                                           |
| Per-key isolation; omitted ≠ undefined (SWR)                                 | `core/asyncProps.ts` verdict block                               | `rowsCells` ("async rowData"), `staleWhileRevalidate`, `asyncBootNoise` |
| Boot off `onSettled`'s scope (no pending links)                              | `agGridSolid.tsx` microtask comment; `gridCreated` backstop      | `asyncBootNoise.browser.test.tsx`                                       |
| Portal identity; props are signal-of-object; stores never hold grid params   | `core/portalManager.ts` verdict                                  | `userCompPortals` suites                                                |
| `props.ref` as static merge source after spreads                             | `gridPortals.tsx`, `customWrapperComp.tsx`, `cellEditorComp.tsx` | reactiveWrappers/editor suites                                          |
| Context: accessors in provider values; null sentinels; default-less = throws | `agGridProvider.tsx`, `core/beansContext.ts`                     | `agGridProvider` suites                                                 |
| CssClassManager (not reactive `class`) on feature-bean roots                 | header comps, `rowComp`                                          | headers parity suite                                                    |
| Values derive; lifecycles effect                                             | every comp — each `createEffect` carries its category comment    | review discipline + this table                                          |

If you change behavior near a row of this table, the "proven by" file is the
first thing to run — and the verdict comment is the first thing to re-read.

## Two walkthroughs to internalize

**A `rowData` change**: user sets a signal → the prop-diff effect's compute
re-snapshots (`snapshotGridProps`, per-key) → apply diffs by identity →
`readyQueue.processWhenReady` → `_processOnChange` → the core's row model
delta-matches by `getRowId` → row/cell ctrls push through their compProxies →
signals → DOM bindings. The wrapper never renders rows "because data changed" —
it relays a command and reflects the core's conclusions.

**A user cell renderer**: colDef names a Solid component → core asks
`SolidFrameworkComponentWrapper.createWrapper` → a `SolidComponent` (or reactive
wrapper) registers a portal entry → `GridPortals` renders it into grid-owned
DOM via `<Portal>` → props updates arrive by `setProps` (identity preserved, no
remount) → the component's own signal reads keep working because the owner
chain crossed the portal. Framework renderers in _cells_ skip portals entirely —
they render inline under the per-cell `<Loading>` boundary.

## Reviewing a change (the checklist)

1. **Which zone?** Comp tree → the ctrl/comp laws apply. `core/` → the timing
   laws apply. `customComp/` → props-push + run-once divergence rules apply.
2. **Every new `createEffect` carries its classification comment** (bridge
   category 1 or 2) — anything else must be derivation. Rendering-state
   effects are an automatic reject.
3. **Comments must be currently-true.** Stale verdict comments are bugs (two
   have already been caught post-fix). If a change invalidates a comment's
   claim, the comment changes in the same commit.
4. **Behavior changes need an oracle scenario**; refactors must not touch
   existing tests (the suite is the preservation proof — 165 tests today).
5. **Gates**: lint, format, typecheck, build, test — plus `check:solid`
   advisory; new SC1xxx findings get triaged, not ignored.
6. **Judgment calls get written down** — in the commit message or the report.
   The six calls in the decomposition commit are the format to imitate.

## Guided reading

1. `src/agGridSolid.tsx` end-to-end — post-decomposition it reads in one
   sitting, and every import from `core/` is one responsibility with a name.
2. `src/core/readyQueue.ts` then `core/gridBoot.ts` — the machinery you'll
   touch when AG Grid v37 changes the boot contract.
3. One full walkthrough with the debugger: set a breakpoint in
   `_processOnChange` and change `rowData` in the playground — watch the
   command path, then watch a cell update land without it.

## Checkpoints

1. A PR adds `createEffect(() => rowStyles(), applyStylesToRow)` in
   `rowComp.tsx`. Which two checklist items does it fail, and what should the
   code do instead?
2. AG Grid v37 renames `ctrlsSvc` and changes `whenReady`'s signature. Using
   the module map, list every file you expect to touch — then check the map's
   answer against `grep -rn "ctrlsSvc" src/`.
3. Why must `core/` never import from the comp tree (what breaks — dependency
   direction, testing, or both)?
4. Your future self finds a verdict comment contradicting observed behavior.
   What's the protocol — trust the comment, the behavior, or neither, and what
   do you do first?
