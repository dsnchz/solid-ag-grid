# SSR guide

`@dschz/solid-ag-grid` works in server-side-rendered Solid apps (SolidStart, TanStack Start) out of the box.

## The contract

- **Server render:** `<AgGridSolid>` renders only its outer shell divs. No grid is created, no browser APIs are touched, nothing grid-shaped is serialized into the HTML payload. (Nobody server-renders grid rows — this is the same contract `ag-grid-react` has in Next.js.)
- **Client:** the grid boots **exactly once**, after hydration, inside the component's settle phase, guarded by both an explicit `isServer` check and an idempotence guard (so async props resolving later can never boot a second grid on the same elements).

This contract is pinned by a dedicated SSR test project (node environment, Solid's SSR compilation) in this package's CI.

## Framework setup

### SolidStart / TanStack Start

Nothing special required:

```tsx
import { AgGridSolid } from "@dschz/solid-ag-grid";

// use it directly in a route component — server renders the shell,
// the grid boots on the client after hydration
```

`clientOnly()` is **optional**, not required. Use it only if you additionally want to skip server-rendering the shell divs (e.g. to keep the grid's subtree out of hydration entirely):

```tsx
import { clientOnly } from "@solidjs/start";
const Grid = clientOnly(() => import("~/components/grid"));
```

### Why it works: the `solid` export condition

The package's `exports` map ships three things:

```jsonc
{
  ".": {
    "solid": "./dist/source/index.jsx", // Solid source (JSX preserved)
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js", // client-compiled JS
  },
}
```

Solid-aware bundlers (`vite-plugin-solid`, and therefore SolidStart and TanStack Start) resolve the `solid` condition and compile the shipped source **per environment** — DOM output for the client bundle, SSR output for the server bundle. That is how the same component can render a shell on the server and a live grid on the client.

## Known limitation: direct Node import of the compiled build

The precompiled `dist/index.js` is **client-compiled** (DOM JSX output). Importing the package in plain Node — no bundler, no `solid` condition — throws:

```bash
node -e "import('@dschz/solid-ag-grid')"   # ✗ throws (client-compiled build)
```

You will hit this only if you:

- import the package in a bare Node script / server runtime without a Solid-aware bundler in front of it, or
- run it through a bundler or test runner that is not configured to resolve the `solid` export condition for server builds.

**Workarounds:**

1. **Use a Solid SSR setup** (SolidStart, TanStack Start, or vite-plugin-solid with SSR) — the `solid` condition routes around the problem entirely. This is the supported path.
2. If your tool lets you configure export conditions, add `"solid"` to the server-side resolution conditions so the shipped source is compiled for SSR.
3. Otherwise, lazy-import the package from client-only code paths (`clientOnly()`, dynamic `import()` inside `onSettled`/event handlers).

Note the limitation is about _importing the compiled build in Node_, not about SSR support: `ag-grid-community` and this package's source are import-safe on the server, and the SSR contract above is tested. A dedicated server-compiled build may ship in a future release if demand warrants.

## See also

- [Reactivity guide](./reactivity.md)
- [README — SSR](../README.md#ssr)
