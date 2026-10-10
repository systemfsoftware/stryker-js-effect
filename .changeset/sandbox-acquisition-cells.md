---
"@systemfsoftware/stryker-js": patch
---

The sandbox is acquired the same way as before: in place or copied, with the same backup restore, build command and node_modules links. The `stryker.sandbox.build.run` and `stryker.sandbox.symlink_node_modules` spans now sit beside `stryker.sandbox.acquire` instead of inside it, and the "Start symlink node_modules" debug line is logged only when node_modules are linked.
