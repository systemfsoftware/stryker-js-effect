---
"@systemfsoftware/stryker-js-plugin-interface": minor
---

A complete dry-run result can carry `testFileModules`: for each test file, the modules it evaluated while it ran. Test runners that know which modules each test file loaded can report them, so incremental runs can key a test file on what it actually loaded.
