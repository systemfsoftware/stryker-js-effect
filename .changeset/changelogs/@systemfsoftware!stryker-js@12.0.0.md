## 12.0.0

### Major Changes

- Restore `defineConfig` and `mergeConfig` on `@systemfsoftware/stryker-js/config`. `defineConfig` accepts an options object, a promise of one, or a `(env: ConfigEnv) => …` factory, as in 10.1.1, and `mergeConfig(defaults, overrides)` composes presets again. `StrykerConfig` is again the partial-options type, so `const config: StrykerConfig = defineConfig({ … })` typechecks. Config files written against the 10.1.1 `./config` surface load and typecheck without edits.

  This removes the 11.0.0 `StrykerConfig` class value. If you adopted it:

  - Replace `StrykerConfig.define(…)` with `defineConfig(…)` and `StrykerConfig.merge(…)` with `mergeConfig(…)`, imported from `@systemfsoftware/stryker-js/config`.
  - Replace `StrykerConfig.createDefaultOptions()` and `StrykerConfig.defaultOptions` with `Configuration.createDefaultOptions()` and `Configuration.defaultOptions` from the package entry point.

### Patch Changes

- A failed dry run now says which tests broke and why. The refusal names every failing test with its failure message in the error output and in the log at the default level, instead of reporting only how many failed.

- Installing `@systemfsoftware/stryker-js` on its own now works. `effect` was declared an optional peer even though Stryker imports it at runtime. Package managers never install optional peers, so a project without `effect` failed with `Failed to read config` before the run started. `effect` is now a required peer: pnpm and npm install it automatically, and a project that already uses Effect shares its own copy with Stryker.

- The packages now build on the latest `@systemfsoftware/effect-cell-types` 10.2 cell kinds, with no change to their published behavior.

  - `@systemfsoftware/stryker-test-contribution` exports its evaluator as `Judge`, `TestContribution`, and `TestContributionEvaluator`, and now depends on `effect` directly.
