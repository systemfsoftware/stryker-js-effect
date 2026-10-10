---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

The checker's equivalent-mutant detection no longer writes `.js` files next to your TypeScript sources. When your tsconfig reaches other sources through `paths` aliases or package imports, earlier versions left a compiled `.js` beside each of those files after a run. On the next run those files could change which tests ran.

If an earlier version left stray `.js` files beside your `.ts` sources, delete them.
