---
"@systemfsoftware/stryker-js": minor
---

A failed run's record reaches every surface: the Mutation Server Protocol answers engine failures with the record in error.data and keeps serving, MCP rerun_mutant returns a RerunEngineUnusable refusal carrying it and the new get_failure tool reads reports/mutation/failure.json, a configured sarif reporter writes a SARIF log whose invocation is executionSuccessful false with one notification per record, and the run log no longer prints an orphan 'Possible causes' block or the bundled parser's WASI ExperimentalWarning.
