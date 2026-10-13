---
"@systemfsoftware/stryker-js": major
---

Runs that share one `tempDirName` directory no longer break each other's sandboxes. A finishing run removes its own sandbox, then removes the shared directory only if it is empty at that moment. A run that starts while another removes the shared directory creates it again and continues.

`Engine.EnginePorts` now includes the `EmptyDirectory` service. `Engine.nodePlatformLayer` provides it, so runs under that layer need no change. Code that builds the engine's ports itself must provide `Engine.nodeEmptyDirectoryLayer`, or its own `EmptyDirectory` whose `removeIfEmpty` resolves when the directory was removed, was already gone, or holds entries or is not a directory, and rejects with a `PlatformError` otherwise.
