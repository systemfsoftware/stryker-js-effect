---
"@systemfsoftware/stryker-js": major
---

Runs that share one `tempDirName` directory no longer break each other's sandboxes. A finishing run removes its own sandbox, then removes the shared directory only if it is empty at that moment. A run that starts while another removes the shared directory creates it again and continues.

`Engine.EnginePorts` now includes a service that removes the shared directory only when it is empty. Only `Engine.nodePlatformLayer` provides it, so runs under that layer need no change, and code that builds the engine's ports from separate layers must build them from `Engine.nodePlatformLayer` instead.
