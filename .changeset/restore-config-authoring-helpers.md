---
'@systemfsoftware/stryker-js': major
---

Restore `defineConfig` and `mergeConfig` on `@systemfsoftware/stryker-js/config`. `defineConfig` accepts an options object, a promise of one, or a `(env: ConfigEnv) => …` factory, as in 10.1.1, and `mergeConfig(defaults, overrides)` composes presets again. `StrykerConfig` is again the partial-options type, so `const config: StrykerConfig = defineConfig({ … })` typechecks. Config files written against the 10.1.1 `./config` surface load and typecheck without edits.

This removes the 11.0.0 `StrykerConfig` class value. If you adopted it:

- Replace `StrykerConfig.define(…)` with `defineConfig(…)` and `StrykerConfig.merge(…)` with `mergeConfig(…)`, imported from `@systemfsoftware/stryker-js/config`.
- Replace `StrykerConfig.createDefaultOptions()` and `StrykerConfig.defaultOptions` with `Configuration.createDefaultOptions()` and `Configuration.defaultOptions` from the package entry point.
