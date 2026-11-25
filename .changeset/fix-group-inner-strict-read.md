---
"@dschz/solid-ag-grid": patch
---

Fix a `STRICT_READ_UNTRACKED` warning when a Solid component is the inner renderer of a group cell. The renderer params are now passed as a plain object instead of a reactive spread.
