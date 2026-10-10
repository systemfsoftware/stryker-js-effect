---
"@systemfsoftware/stryker-js-instrumenter": major
"@systemfsoftware/stryker-js": major
---

Under the default `mutator.mutantSetPolicy`, a relational comparison in an `if`, loop, or ternary test no longer has its mutants Ignored by the sufficient-set table. That table dropped the complementary operator and one boolean literal at every such site, but its proof assumes numeric operands, which JavaScript does not guarantee. In `if (a < b)` with `a` null and `b` undefined, the dropped `true` mutant enters the branch and no kept mutant does, so a test that killed only that mutant went uncounted. Operands whose `valueOf` has side effects defeat the dropped operators the same way. Those mutants now run.

Breaking: default runs plant more active mutants in condition positions, so mutation scores and the set of mutants that run differ from the previous release. The generated mutants and their ids are unchanged.
