---
"@systemfsoftware/stryker-js-plugin-interface": minor
---

A plugin specifier now accepts a bare package name, with or without a subpath, in every option that takes one: `plugins`, `appendPlugins`, `ignorers`, a custom `testRunner.plugin`, and `checkers[].plugin`. `file://` URLs keep working.
