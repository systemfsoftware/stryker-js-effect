---
"@systemfsoftware/stryker-js-engine": minor
---

the plugin loader accepts modules exporting `strykerIgnorers` (`{ name, shouldIgnore }`, each entry registered as an `Ignore` contribution) — no `effect` peer, no plugin-interface import needed for an ignorer module; a plain entry whose `name` is not a string or whose `shouldIgnore` is not callable is rejected at load with `PluginLoadFailedError` naming the module; native `strykerPlugins` modules load unchanged, and the default `plugins:` preset now names `@systemfsoftware/stryker-ignorer-effect-schema-declarations` and `@systemfsoftware/stryker-ignorer-workflow-make-boundary` instead of the `@systemfsoftware/stryker-plugins` subpaths, so configs using the old names must move to the new packages
