---
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js-instrumenter": minor
"@systemfsoftware/stryker-js": none
---

Every `Mutant` now carries a required `probeEligibility`: `Probed { kind }` when a dry run could compute the mutant's value from operands the original code already evaluates (`arithmetic`, `relational`, `unary` or `constant`), otherwise `Unprobed { reason }`. A mutant decoded or constructed without the field reads `Unprobed` with reason `not-decided`. The `Mutant` namespace exports the new schemas.

The instrumenter marks `Probed` the `-`, `*`, `/` and `%` arithmetic swaps, swaps of a `<`, `<=`, `>` or `>=` comparison, `+x`/`-x` sign flips, and `true`/`false` replacements of a comparison between two literals. Nothing reads the field yet: mutant statuses and the tests each mutant runs are unchanged.

Migration: code that builds a `Mutant` object literal must set `probeEligibility`.
