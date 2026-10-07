---
"@systemfsoftware/stryker-js-plugin-interface": patch
---

A complete dry run can now carry `testFileModules`, a record from each test file's path to the modules that file evaluated while it ran, so an incremental run can key a test file's closure on the modules it actually loaded instead of on every file a dynamic import might reach.
