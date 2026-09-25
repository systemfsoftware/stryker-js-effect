---
"@systemfsoftware/stryker-js-vitest-runner": patch
---

A test file that fails as a whole — a suite that registers no tests, a file that throws while loading, or a `beforeAll`/`afterAll` hook that fails — is now reported as a failing test carrying the file's own message. A mutant that breaks a file this way is reported as Killed instead of Surviving, and a dry run that loads such a file fails naming it.

Skipped tests that never start are now reported as skipped rather than dropped from the run's results.

A mutant run whose related files match no test file no longer stops with a test-runner crash; the run continues with no test able to kill the mutant.
