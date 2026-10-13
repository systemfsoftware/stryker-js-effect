---
"@systemfsoftware/stryker-js": major
---

Runs that share one `tempDirName` directory no longer break each other's sandboxes. A run that finishes removes its own sandbox and then removes the shared directory only if it is empty at that moment, so another run's sandbox is never deleted with it. A run that starts while another run removes the shared directory creates it again and continues, instead of failing.

`Engine.EmptyDirectory.removeIfEmpty` resolves when the directory was removed, was already gone, or was left in place because it holds entries or is not a directory; only other failures reject with a `PlatformError`.

`Engine.EnginePorts` now includes the `EmptyDirectory` service. `Engine.nodePlatformLayer` provides it, so a run under that layer needs no change. Code that builds the engine's ports itself must provide an `EmptyDirectory` layer; `Engine.nodeEmptyDirectoryLayer` is the implementation the platform layer uses. `Engine` exports the `EmptyDirectory` service, its `EmptyDirectoryShape`, and `Engine.nodeEmptyDirectoryLayer`.
