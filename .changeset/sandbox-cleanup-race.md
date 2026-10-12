---
"@systemfsoftware/stryker-js": major
---

Runs that share one `tempDirName` directory no longer break each other's sandboxes. A run that finishes removes its own sandbox and then removes the shared directory only if it is empty at that moment, so another run's sandbox is never deleted with it. A run that starts while another run removes the shared directory creates it again and continues, instead of failing.

`Engine.EnginePorts` now includes an `EmptyDirectory` service. `Engine.nodePlatformLayer` provides it, so code that runs the engine under that layer needs no change. Code that builds the engine's ports itself must add an `EmptyDirectory` layer. `Engine` exports the `EmptyDirectory` service and its `EmptyDirectoryShape`.
