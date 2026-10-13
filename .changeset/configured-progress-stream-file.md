---
"@systemfsoftware/stryker-js": patch
---

A mutation run now writes its event stream to the `progressStreamFile` set in the Stryker config file; before, only the `--progressStreamFile` flag moved it. The flag still wins over the config file. Stream files at the configured path or at `reports/mutation-stream.jsonl` no longer make the next run re-run every mutant, including those left by other `stryker` commands. If you read the stream from `reports/mutation-stream.jsonl` while your config names another path, read it from the configured path.
