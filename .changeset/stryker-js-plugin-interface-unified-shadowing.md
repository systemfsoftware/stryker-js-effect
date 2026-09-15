---
"@systemfsoftware/stryker-js-plugin-interface": major
---

`composePlugins` no longer computes plugin shadowing. `ComposedPlugins.shadowings`
and the `Shadowing` record are removed; the engine's plugin loader is the single
source, and it reports shadowing by winning and losing module name for both name
collisions and framework extension claims. A consumer that read
`composePlugins(contributions).shadowings` reads the loader's plugin load plan
instead.
