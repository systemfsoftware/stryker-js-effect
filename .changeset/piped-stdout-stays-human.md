---
"@systemfsoftware/stryker-js": minor
---

A piped `stdout` now gets human output, exactly like a terminal. Machine consumers ask for the NDJSON event stream explicitly, with `--json` or `STRYKER_MODE=machine`; `--format text` names the human format, and passing it together with `--json` is a usage error (exit 2). Under `--json`, `stdout` carries wire records and nothing else, while progress status lines and log output stay on `stderr`.

Every run also writes those wire records to `reports/mutation-stream.jsonl` in human mode too, so a job that shows a readable log still produces the artifact `stryker merge-reports` rebuilds a shard's report from.

If a script or CI step read NDJSON from a piped run without requesting it, pass `--json` (or set `STRYKER_MODE=machine`) there.

Custom `RunEventDrain` implementations must accept a required `toStdout` argument in `drainFramed`; pass-throughs can ignore it.
