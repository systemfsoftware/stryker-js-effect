---
"@systemfsoftware/stryker-js": major
---

A mutation run now writes its event stream to the `progressStreamFile` set in the Stryker config file; the flag still wins. Stream files at that path or at `reports/mutation-stream.jsonl` no longer make the next run re-run every mutant, nor does an output path spelled with `./`, `//` or a trailing slash.

Breaking:

- With a non-empty `progressStreamFile` in your config, a mutation run's stream is no longer at `reports/mutation-stream.jsonl`; read the configured path.
- A config function is called once more per run: the stream path comes from its first answer, every other option from its second, so it must answer the same each time and not fail.
- Your own `reports/mutation-stream.jsonl` is no longer part of the project Stryker copies and hashes.
- `RunEvent.RunEventDrain.DefaultProgressStreamFile` is removed; the `Configuration.defaultOptions` effect yields `progressStreamFile`.
