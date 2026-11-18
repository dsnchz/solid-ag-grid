# Chapter 2 — The Solid 2.0 timing model (and the port's reactive doctrine)

Chapter 1 explained AG Grid's architecture. This chapter explains the other half
of the marriage: how Solid 2.0's scheduling actually behaves, what laws the port
discovered empirically (each backed by a test), and the doctrine that decides
which reactive construct every piece of state uses.

## Async data vs async commit — the load-bearing distinction

Solid 2.0's headline is first-class **async data**: computations can await,
`<Loading>` reflects readiness, the graph tracks pending state. None of that
replaces the wrapper's accommodation machinery (`whenReady`,
`RenderStatusService`, `flush()`), because that machinery solves **async
commit**: signal writes land on a microtask, and an imperative core sometimes
needs to know its pushes hit the DOM (measuring, scrolling) _now_. There is no
promise anywhere in that problem — no async value to suspend on. The lag is
between write and commit, which the graph treats as internal scheduling.

- Async **data** crosses the boundary at user props and user components →
  embrace it (async rowData, `<Loading>`-wrapped cell renderers).
- Async **commit** is bridged by ported machinery (`agFlush`, ready queues,
  `RenderStatusService`) → port it faithfully; never redesign it reactively.

## The write/read legality map (all empirically proven)

| Scope                                                                                                      | Write signals?                                                                                                                                                                                                                                           | Read signal-backed props?                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref` callbacks (run untracked in the creating pass's context, parent→child, on **disconnected** elements) | ✓ legal — but a ref **owns nothing**: creating a memo/effect/root throws `PRIMITIVE_IN_EFFECT_CALLBACK` and `onCleanup` throws `CLEANUP_IN_FORBIDDEN_SCOPE` (Solid ≥ 2.0.0-rc.22, solidjs/solid#4761). Prepare owners and cleanups in the component body | untracked — the read never subscribes. Before rc.22 refs ran unowned and mid-flush reads saw the pre-flush value (`REACTIVITY_HALTED` in the wild). Capture in the component body with `untrack(() => props.x)` |
| Effect **apply** phase                                                                                     | ✓ legal                                                                                                                                                                                                                                                  | ✓ tracked via compute phase                                                                                                                                                                                     |
| `onSettled`                                                                                                | ✓ legal                                                                                                                                                                                                                                                  | ✓ but **it subscribes to caught pending async reads** and re-runs on resolve — once-only work needs an idempotence guard (this booted a second grid before it was caught)                                       |
| Memo/compute/component body                                                                                | ✗ throws `REACTIVE_WRITE_IN_OWNED_SCOPE`                                                                                                                                                                                                                 | ✓ (the normal case)                                                                                                                                                                                             |
| **Disposal** (`onCleanup`, cleanup fns)                                                                    | ✗ throws and **halts the reactive system** — bridge signals cleared during teardown need `ownedWrite: true`                                                                                                                                              | —                                                                                                                                                                                                               |

Related mechanics: Solid refs fire parent-before-children (React commits
bottom-up) → comps whose ctrls need child elements use a guarded `setup()`
called from every ref. `flush()` is a safe `flushSync` stand-in — legal even
mid-apply; the `runWithoutFlush` latch is hygiene, not correctness.

## The reactive doctrine (what construct for what state)

1. **Atoms from the core → signals.** compProxy setters are pre-atomized
   pushes (`setWidth`, `toggleCss`); independent signals _are_ the fine-grained
   representation. Stores would recompose atoms just to split them again.
2. **Values derive; lifecycles effect.** Rendering state is memos + derived
   JSX; `createEffect` only for (a) reactive→core pushes, (b) signal-keyed
   lifecycle of non-Solid instances. Memos are lazy and must stay pure — never
   create instances in them.
3. **Object-props pushed into live components → signal-of-object, NOT a
   store.** Solid 2.0's `isWrappable` wraps class instances (unlike 1.x): a
   store would hand user components deep proxies over `api`/`node`/`column`,
   breaking identity and turning core-internal mutations into write hazards.
   Portal entries keep identity; `setProps` replaces the object wholesale.
4. **Class instances (ctrls, GridApi) are never proxied.** Raw references,
   identity-keyed through `<For>`.
5. **Non-derived machinery state → plain mutables.** `let ready = false` is
   deliberate: nothing derives from it, and queues need read-after-write
   immediacy that batched signals cannot give. Code must tell the truth about
   what is reactive.
6. **The grid core owns the data.** Row data granularity is the core's batch
   row model (diff-by-`getRowId`, transactions) — not a store's. Store
   mutations are invisible to the grid (identity-diffed doorway). The
   store→transaction adapter (roadmap, opt-in `rowStore`) bridges this
   declaratively _on top of_ the public API.

## Scorecard vs the React wrapper

Deleted outright: `useSyncExternalStore` dual paths, `memo()`/`useCallback`
ceremony, StrictMode workarounds. The body+containers+header shell carries
three effects; rows+cells two — every one classified. Derived JSX insertion of
JS-component GUIs _exceeds_ React (elements migrate parents when wrappers
toggle). Seeding beats React (zero empty-row-flash, proven by rAF sampling).
Costs unique to 2.0: the stale-read ref law, inverted ref order, `onSettled`
async subscription, `ownedWrite` disposal law — fewer pretzels, different
locations, all concentrated at the bridge and named.

## The #1 user footgun (docs-bound): reads after `await` never track

```ts
const rows = createMemo(async () => {
  const data = await fetchRows(); // tracking ENDS here
  return data.filter((r) => r.owner === userId()); // userId() NEVER re-runs this
});
```

Read signals _before_ the first `await`. `solid-checker` (advisory
`check:solid` script) flags this as `reactive-read-after-await`.

## Guided reading

1. `src/agGridSolid.tsx` — the Q9 verdict block + `gridCreated` guard: async
   subscription and idempotence in one place.
2. `test/unit/flushSemantics.test.tsx` — the legality map as executable spec.
3. `src/core/portalManager.ts` — the portal identity verdict; then
   `src/customComp/customWrapperComp.tsx` for signal-of-object props-push.
4. `src/cells/createJsCellRenderer.ts` — a category-2 lifecycle bridge with
   `ownedWrite` applied.

## Checkpoints

1. Why can a `ref` callback legally _write_ a signal it could not correctly
   _read_? What is each half of the asymmetry protecting?
2. A colleague proposes storing portal props in a `createStore` for finer
   granularity. Using the `isWrappable` law, explain what breaks first.
3. Why does the `gridCreated` guard exist even though `onSettled` "runs once"?
4. The grid core asks "has the framework painted my cells?" — why can't that
   question be answered by the reactive graph, and what answers it instead?
