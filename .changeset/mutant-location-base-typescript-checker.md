---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

The checker now applies each mutant at the position the mutant reports, since
those positions are 1-based lines. A mutated line other than the first was
previously rewritten further down the file, so the checker compiled something
other than the mutant it was given and could report the wrong verdict for it.
