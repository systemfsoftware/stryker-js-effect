## 11.0.0

### Patch Changes

- A mutation run no longer stalls forever when a checker or test-runner worker stops answering its connection. Previously a request that was in flight when the worker's connection dropped kept waiting on the dead connection, freezing progress until the CI timeout killed the run. Such a request now fails with a typed connection error when its connection drops, and the worker is restarted per the existing crash policy. Only requests already sent on the dropped connection fail: the client still reconnects on its own, and requests made while it reconnects, including the first request to a worker that is still booting, wait for the connection instead of failing.
