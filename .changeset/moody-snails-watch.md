---
"@systemfsoftware/stryker-js-cli-contract": minor
---

RunFailed now carries a typed FailureRecord (catalog code, stage, structured evidence, cause chain, next action, replay capsule, trace id) instead of error/remediation/reason prose; the stream schema is 3.0. The package publishes contract/failure-catalog.json and FailureRecord renderers for terminal, markdown, GitHub annotations and SARIF.
