---
"@systemfsoftware/stryker-js": major
---

A mutation run now writes its event stream to the `progressStreamFile` set in the Stryker config file, and the `--progressStreamFile` flag still wins. Stream files at that path or at `reports/mutation-stream.jsonl` no longer make the next run re-run every mutant, and an output path spelled with `./`, a doubled slash or a trailing slash is left out of the project.

Breaking:

- With `progressStreamFile` in your config, the stream is no longer at `reports/mutation-stream.jsonl`; read the configured path.
- A config that exports a function has it called once more per run; it must answer the same options each time.
- Your own `reports/mutation-stream.jsonl` is no longer part of the project Stryker copies and hashes.
- `RunEvent.RunEventDrain.DefaultProgressStreamFile` is removed; the default is `reports/mutation-stream.jsonl`.
