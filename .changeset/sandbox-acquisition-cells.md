---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-cli-contract": patch
---

The sandbox is acquired the same way as before: in place or copied, with the same backup restore, build command and node_modules links. `stryker.sandbox.build.run` and `stryker.sandbox.symlink_node_modules` still sit inside `stryker.sandbox.acquire`, the symlink span and its "Start symlink node_modules" debug line still appear on every run, and an in-place run still restores its original files when the sandbox closes. The copy and preprocessing step inside the acquisition now has its own span, `stryker.sandbox.prepare`, which the span taxonomy declares.
