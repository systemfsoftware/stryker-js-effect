---
"@systemfsoftware/stryker-js-plugin-interface": major
---

Plugin boundaries carry their real values:

- `Plugin.ReporterInitOptions.traceparent` and `tracestate` are typed by the W3C trace-context schemas (`Trace.Traceparent`, `Trace.Tracestate`) instead of plain strings, and an invalid traceparent is no longer forwarded to a reporter worker.
- `Checker.CheckResultSchema` is the one source of a check result; `Checker.CheckStatus` is unchanged in value.
- `Plugin.PluginKind` and `Plugin.EvaluatorPluginKind` are new and replace the repeated `'Evaluator'` literal.
- The `maxConcurrentTestRunners`, `maxTestRunnerReuse`, `timeoutMS`, `timeoutFactor` and `concurrency` options refuse values outside their real range (negative durations, a zero or fractional worker count).
