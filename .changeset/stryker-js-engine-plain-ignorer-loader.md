---
"@systemfsoftware/stryker-js-engine": minor
---

the plugin loader accepts modules exporting `strykerIgnorers` (`{ name, shouldIgnore }`) and registers each entry as an `Ignore` contribution — no `effect` peer, no plugin-interface import needed for an ignorer module; native `strykerPlugins` modules load unchanged, and the default `plugins:` preset now names `@systemfsoftware/stryker-ignorer-effect-schema-declarations` and `@systemfsoftware/stryker-ignorer-workflow-make-boundary` instead of the `@systemfsoftware/stryker-plugins` subpaths, so configs using the old names must move to the new packages
