---
'@systemfsoftware/stryker-js-vitest-runner': patch
---

Tests inside `describe` blocks now kill the mutants they cover. A nested test's full name joins its suite levels with `" > "`, but the test ids this runner stored and matched a mutant's run against joined the levels with a plain space, so the selection matched nothing for any test nested in a suite and the mutant was reported as survived — mutation scores came out lower than the tests justified. Killed-by and covered-by test names in reports now use full test names, with `" > "` between suite levels.
