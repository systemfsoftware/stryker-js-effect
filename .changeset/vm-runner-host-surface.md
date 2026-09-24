---
"@systemfsoftware/stryker-js": major
---

The `VmRunner`, `VmPlatform`, and `VmFileUrl` exports are removed from the `Plugin` namespace of `@systemfsoftware/stryker-js`, and `VmTestRunnerConfig.sandboxWorkingDirectory` is now required rather than optional. Code that imported the removed names, or that built a vm runner config without a working directory, must drop those imports and pass `sandboxWorkingDirectory`.
