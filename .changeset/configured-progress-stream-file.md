---
"@systemfsoftware/stryker-js": major
---

A mutation run now writes its event stream to the `progressStreamFile` set in the Stryker config file; the flag still wins. Stream files at that path, spelled with `./`, `//` or a trailing slash, or at `reports/mutation-stream.jsonl` no longer make the next run re-run every mutant. A stream file that cannot be opened or written no longer silences `--json` output.

Breaking:

- A non-empty `progressStreamFile` in your config moves a mutation run's stream off `reports/mutation-stream.jsonl`.
- A config function is called once more per run: the stream path comes from its first answer, every other option from its second, and a failure on the second call fails the run.
- Your own `reports/mutation-stream.jsonl` is no longer a project input.
- `RunEvent.RunEventDrain.DefaultProgressStreamFile` is removed; the `Configuration.defaultOptions` effect yields `progressStreamFile`.
