---
"@systemfsoftware/stryker-js": major
---

Configuration helpers move onto `StrykerConfig`, and internal helpers leave the package entry point.

- Replace `defineConfig(…)` with `StrykerConfig.define(…)` and `mergeConfig(…)` with `StrykerConfig.merge(…)`, imported from the `./config` entry point.
- Replace `createDefaultOptions`, `defaultOptions`, `SUPPORTED_CONFIG_FILE_NAMES` and `CONFIG_SYNTAX_HELP` with the `StrykerConfig` statics `createDefaultOptions`, `defaultOptions`, `supportedFileNames` and `syntaxHelp`.
- Replace `calculateMetrics` with a decode through `MetricsResultFromReport`.
- Remove imports of the other dropped helpers, such as `resolveExitCode`, `buildVerdictEnvelope`, `makeRunLayer` and the checker metric instruments. They have no public replacement.
