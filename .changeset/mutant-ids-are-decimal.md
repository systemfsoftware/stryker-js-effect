---
"@systemfsoftware/stryker-js-instrumenter": major
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js": major
---

Mutant ids are decimal index strings. Every engine schema that carried a mutant id as a plain string now decodes `Mutant.MutantId` and refuses anything else: reporter events (`mutationTestingPlanReady` plans, `mutantTested`), the machine run stream's `mutant` event, the survivors prior report, checker answers, and the mutant coverage keys produced by test runners. The mutation report and the stream's `verdict` mutants follow the upstream mutation-testing report schema, which types a mutant id as a string.

Mutant ids are minted only as the mutant's canonical non-negative decimal index (`Mutant.MutantId`), including in the instrumenter's planned mutants, placement sites, and checker answers. Consume the new `Mutant.MutantId` schema instead of assuming an arbitrary non-empty string; ids such as `constructor` or `__proto__` no longer decode.
