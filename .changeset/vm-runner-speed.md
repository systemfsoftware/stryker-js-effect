---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-vm-harness": patch
---

The vm runner now runs far less work per mutant. Its dry run records per-test mutant coverage, so a mutant run executes only the tests that cover it instead of the whole suite; a run that reaches the configured test hit limit stops there, and a mutant run that does not reload the environment reuses the already-loaded module graph. A module with present-but-empty coverage no longer falls back to running every test, and each test-runner instance runs tests in its own worker thread instead of queueing behind one shared lock, so independent runs overlap.
