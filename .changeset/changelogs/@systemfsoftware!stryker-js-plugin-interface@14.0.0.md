## 14.0.0

### Major Changes

- A mutant's timeout now starts when its first test begins, not when the test runner is asked to run it. With a short `timeoutMS`, a mutant its tests would kill is reported `Killed` instead of `Timeout`, so a slow or busy machine no longer changes the verdict. A mutant whose tests never begin still ends, on the same window that bounds a plugin worker which never accepts its connection.

  If you author a test-runner plugin, `mutantRun` now streams its run: emit `MutantRunStarted` before the runner's first test begins, then `MutantRunSettled` carrying the result.
