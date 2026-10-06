---
"@systemfsoftware/stryker-js": patch
---

A shard run keeps going when one of its projects scores under `thresholds.break` over the shard's mutants. It runs the remaining projects, exits 0, and notes that the merged report carries the project verdict. A shard fails only when a project fails for a real reason: another exit code, or no progress stream. Its error names the project, the exit code and the tail of that project's error output.

Every non-zero exit now says why in human mode. One final stderr line names the exit code, its class (`VerdictFail`, `ConfigError`, `RuntimeError`, `InternalError`) and the failure with its remediation. A rejected survivor check and a refused re-run no longer print it twice.

A config file that throws while loading now reports the thrown error instead of `Failed to read config`.
