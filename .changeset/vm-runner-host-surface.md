---
"@systemfsoftware/stryker-js": major
---

The `VmRunner` and `VmPlatform` exports are removed from `@systemfsoftware/stryker-js`, and `VmTestRunnerConfig.sandboxWorkingDirectory` is now required rather than optional. Code that imported the removed names, or that built a vm runner config without a working directory, must drop those imports and pass `sandboxWorkingDirectory`.
