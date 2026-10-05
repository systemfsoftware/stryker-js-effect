---
"@systemfsoftware/stryker-js": patch
---

The README now has an upgrade note for 13.x users. 14.0.0 made `'default'` the default `mutator.mutantSetPolicy`, so scores graded under 13.x and later releases cover different mutant sets and are not comparable. The note names where each run records its policy, and states that `mutator: { mutantSetPolicy: 'full' }` keeps the 13.x mutant set.
