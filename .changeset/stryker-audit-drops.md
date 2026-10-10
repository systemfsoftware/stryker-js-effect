---
"@systemfsoftware/stryker-js": minor
---

New `stryker audit` subcommand. With `--matrix <dir>` it reads a run recorded with every killer kept (`STRYKER_KILL_MATRIX=1`), finds every mutant the default mutant-set policy drops without running a test, and judges each against its dominator: `Pass`, `Vacuous`, `AttributionUnverified` or `Fail`, each with a reason code and a next action. A test whose every killed mutant is dropped is reported as orphaned. `--files` limits the check to the named files, so a pull request checks only what it changes. It exits `1` when a pair fails, a rule has no joined pair, or a test is orphaned, and `2` on unusable input. `--counts-only` counts planned, `CompileError`, compiled and executed mutants and test executions per project from finished reports. Both modes write versioned JSON to `--out` and print at most 20 detail lines.
