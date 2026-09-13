---
"@systemfsoftware/stryker-js-language": major
"@systemfsoftware/stryker-js-plugin-interface": minor
---

`@systemfsoftware/stryker-js` is renamed to `@systemfsoftware/stryker-js-language`, and its plugin interface now ships as the separate package `@systemfsoftware/stryker-js-plugin-interface` (`declarePlugin`, `composePlugins`, `PluginContribution`, `PluginKind`, `PluginEnvironment`, `RunConfiguration`, `SandboxDirectory`).

To migrate, update the package name on every import that is not a plugin symbol to `@systemfsoftware/stryker-js-language`; install `@systemfsoftware/stryker-js-plugin-interface` and import the plugin symbols listed above from it instead.
