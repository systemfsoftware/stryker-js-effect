---
"@systemfsoftware/stryker-js-angular": patch
"@systemfsoftware/stryker-js-svelte": patch
---

The published package manifest now declares `@systemfsoftware/stryker-ignorer-interface` as a dependency: the AST types the plugin handles are imported from the package that owns them. The plugin's exported surface is unchanged.
