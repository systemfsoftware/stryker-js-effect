---
"@systemfsoftware/stryker-js": patch
---

A test runner, checker, or reporter process that starts but never accepts its connection no longer hangs the mutation run forever. Stryker gives each plugin worker 30 seconds to accept the connection on `STRYKER_SOCKET`; a worker that misses that window fails the run with a boot error naming its process id, and the process is stopped. The window does not depend on `dryRunTimeoutMinutes`. A worker that has already connected still reconnects after a dropped connection, as before.
