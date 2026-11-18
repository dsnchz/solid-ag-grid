---
"@dschz/solid-ag-grid": patch
---

First stable release, on Solid 2.0. The `36.0.0-next.N` sections below cover the release-candidate history.

- **Solid 2.0.1.** The `solid-js` and `@solidjs/web` peers move from `^2.0.0` to `^2.0.1`. This package is developed and tested against 2.0.1.
- **`rowStore` on optimistic views:** optimistic structural writes (push, splice, reorder) show in the grid immediately again, and a failed action's revert removes them. On Solid rc.22 – 2.0.0 these writes did not appear until the action settled ([solidjs/solid#5007](https://github.com/solidjs/solid/issues/5007), fixed in Solid 2.0.1). The new peer floor excludes the affected releases.
