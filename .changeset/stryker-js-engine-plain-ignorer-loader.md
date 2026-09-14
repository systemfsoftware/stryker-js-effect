---
"@systemfsoftware/stryker-js-engine": minor
---

the plugin loader accepts modules exporting `strykerIgnorers` (`{ name, schema, shouldIgnore }`, where `schema` is a Standard Schema object checked structurally at load) and registers each entry as an `Ignore` contribution — no `effect` peer, no plugin-interface import needed for an ignorer module; a plain entry without a valid `~standard` schema is rejected at load with `PluginLoadFailedError` naming the module, so modules exporting the earlier two-field shape must add the schema field; native `strykerPlugins` modules load unchanged, and the default `plugins:` preset now names `@systemfsoftware/stryker-ignorer-effect-schema-declarations` and `@systemfsoftware/stryker-ignorer-workflow-make-boundary` instead of the `@systemfsoftware/stryker-plugins` subpaths, so configs using the old names must move to the new packages
