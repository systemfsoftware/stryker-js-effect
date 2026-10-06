## 17.0.1

### Patch Changes

- stryker plan is now faster: it no longer copies the project into a temporary directory or prepares the checkers, test runners, and reporters a full run needs, and it leaves no temporary directory behind. The plan itself is unchanged — the same mutants, scheduled with the same predicted costs.
