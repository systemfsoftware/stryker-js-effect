---

---

This package now publishes declarations only — the run-event vocabulary: the `RunEvents` and `RunIdentity` port tags, the `Run*` event schemas and tagged unions (`RunEvent`, `RunPhase`), and the `PlanMutationRunCommand` / `MutationRunPlan` command schemas.

The rest of what it used to publish now comes from `@systemfsoftware/stryker-js-plugin-interface`: the mutant model and report schemas (`MutantResult`, `MutationTestResult`, `FileResult`), the option type (`StrykerOptions`), the reporter-event schema (`ReporterEvent`), the metrics schemas (`Metrics`, `MetricsResult`), the exit classification (`ExitClass`, `EXIT_CODE`), and the checker, evaluator, and test-runner contracts (`CheckerService`, `EvaluatorService`, `TestRunnerService`).

To migrate, import those names from `@systemfsoftware/stryker-js-plugin-interface`.
