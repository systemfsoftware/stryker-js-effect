---
"@systemfsoftware/stryker-js": major
---

Every failed run ends in one FailureRecord: printed on stderr, emitted as the terminal stream event, and written to reports/mutation/failure.json. StageError and PrepareError are replaced by RunFailure, exit codes come from the failure catalog (a failing baseline test exits 5), failed baseline tests are named by project-relative file and line, and the cli.run span carries stryker.failure.code.
