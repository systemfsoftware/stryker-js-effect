## 7.3.0

### Minor Changes

- The test runner accepts a new `pool` option. When it is `threads`, a Vitest config that enables browser mode for any project is refused at startup with a message naming `testRunner: 'vitest'`.

### Patch Changes

- A run whose selected files produce no mutants, for example because no loaded framework claims them, now runs every test in the dry run and finishes with an empty report. With `testRunner: 'vm'` or `'vitest'` it used to fail with "No tests were executed", because the dry run only looked for tests related to those files. The dry run now relates tests only to the files that carry mutants.

- A failed dry run now names every failing test. The runner used to apply the bail setting to the dry run as well, so Vitest stopped at the first failure and the error listed only that test. Mutant runs still stop at the first failing test unless `disableBail` is set.

- A test file that fails as a whole — a suite that registers no tests, a file that throws while loading, or a `beforeAll`/`afterAll` hook that fails — is now reported as a failing test carrying the file's own message. A mutant that breaks a file this way is reported as Killed instead of Surviving, and a dry run that loads such a file fails naming it.

  Skipped tests that never start are now reported as skipped rather than dropped from the run's results.

  A mutant run whose related files match no test file no longer stops with a test-runner crash; the run continues with no test able to kill the mutant.

- Mutation runs with `testRunner: 'vm'` finish in about half the time, with the same verdicts. The engine checks mutant groups on every checker process at once, stops the checkers as soon as checking ends, hands their share of `concurrency` to the test runners, and shares a Node compile cache with every worker it starts. The Vitest runner starts the next isolated worker thread while the current test file runs, so each file still gets a fresh thread but no longer waits for one to boot. On a 319-mutant TypeScript project with the TypeScript checker, a run went from 24.9 s to 12.6 s.
