## 12.1.0

### Minor Changes

- A piped `stdout` now gets human output, exactly like a terminal. Machine consumers ask for the NDJSON event stream explicitly, with `--json` or `STRYKER_MODE=machine`; `--format text` names the human format, and passing it together with `--json` is a usage error (exit 2). Under `--json`, `stdout` carries wire records and nothing else, while progress status lines and log output stay on `stderr`.

  Every run also writes those wire records to `reports/mutation-stream.jsonl` in human mode too, so a job that shows a readable log still produces the artifact `stryker merge-reports` rebuilds a shard's report from.

  If a script or CI step read NDJSON from a piped run without requesting it, pass `--json` (or set `STRYKER_MODE=machine`) there.

  Custom `RunEventDrain` implementations must accept a required `toStdout` argument in `drainFramed`; pass-throughs can ignore it.

### Patch Changes

- A run whose selected files produce no mutants, for example because no loaded framework claims them, now runs every test in the dry run and finishes with an empty report. With `testRunner: 'vm'` or `'vitest'` it used to fail with "No tests were executed", because the dry run only looked for tests related to those files. The dry run now relates tests only to the files that carry mutants.

- A run whose `mutate` patterns match no file now finishes successfully instead of stopping with an instrument error. It performs the dry run, writes a mutation report with no files, and passes regardless of `thresholds.break`, the same as upstream StrykerJS. A sharded run whose shard receives no file no longer fails.

  `stryker merge-reports` shows `n/a` for a package whose report has no tested mutant, instead of a score of `0.00`.

  Errors reported for the prepare, dry-run, and mutation-testing stages now carry their reason as the error message, so a printed cause no longer shows up as a bare error name.

- `stryker merge-reports` now rebuilds a package's partial report from the mutants recorded in its stream part when the run ended before writing its final report. Earlier versions recognized none of the recorded mutants and reported the package as having no report.

- Mutation runs with `testRunner: 'vm'` finish in about half the time, with the same verdicts. The engine checks mutant groups on every checker process at once, stops the checkers as soon as checking ends, hands their share of `concurrency` to the test runners, and shares a Node compile cache with every worker it starts. The Vitest runner starts the next isolated worker thread while the current test file runs, so each file still gets a fresh thread but no longer waits for one to boot. On a 319-mutant TypeScript project with the TypeScript checker, a run went from 24.9 s to 12.6 s.

- `testRunner: 'vm'` runs Vitest itself on Vitest's isolated `threads` pool instead of an in-process reimplementation, and stays the default `testRunner`. It reports the same test ids, outcomes and per-mutant verdicts as `testRunner: 'vitest'`, so a project whose Vitest config enables browser mode is refused at startup with a message naming `testRunner: 'vitest'`.

  Stryker no longer discovers test files for `vm`: Vitest selects them from your config, as it does for `testRunner: 'vitest'`. A run that loads no test files fails the dry run naming `testFiles`.
