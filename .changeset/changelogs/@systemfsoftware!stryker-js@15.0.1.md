## 15.0.1

### Patch Changes

- `cleanTempDir` now decides from how the run ended. With the default (`true`), a successful run removes its `.stryker-tmp/sandbox-*` directory and a failed run keeps it; previously every sandbox was kept, so `.stryker-tmp` grew with each run. `cleanTempDir: false` now keeps the sandbox after every run instead of deleting it. `'always'` still removes it after every run.

- A test runner, checker, or reporter process that stops responding no longer hangs the mutation run forever. When such a process does not exit within 5 seconds of being asked to stop, Stryker force-kills it, so the run ends with an error instead of waiting until something kills it from outside.

- A test runner, checker, or reporter process that starts but never accepts its connection no longer hangs the mutation run forever. Stryker gives each plugin worker 30 seconds to accept the connection on `STRYKER_SOCKET`; a worker that misses that window fails the run with a boot error naming its process id, and the process is stopped. The window does not depend on `dryRunTimeoutMinutes`. A worker that has already connected still reconnects after a dropped connection, as before.
