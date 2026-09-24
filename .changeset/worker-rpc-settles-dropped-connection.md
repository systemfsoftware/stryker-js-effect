---
'@systemfsoftware/stryker-js': patch
---

A mutation run no longer stalls forever when a checker or test-runner worker stops answering its connection. Previously a request that was in flight when the worker's connection dropped kept waiting on the dead connection, freezing progress until the CI timeout killed the run. Such a request now fails within two ping windows with a typed connection error, the worker is restarted per the existing crash policy, and requests made once the replacement connection is up are served normally.
