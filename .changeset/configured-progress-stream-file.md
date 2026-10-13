---
"@systemfsoftware/stryker-js": major
---

A mutation run now writes its event stream to the config's `progressStreamFile`; the flag still wins. Stream files there, however spelled, or at `reports/mutation-stream.jsonl` no longer make the next run re-run every mutant; Stryker's output paths match with exact case. A stream path naming an existing file that is not a Stryker stream leaves it intact and, like an unwritable one, keeps `--json` output.

Breaking:

- A non-empty config `progressStreamFile` moves a run's stream off `reports/mutation-stream.jsonl`.
- A config function is called once more per run: its first answer sets the stream path (the flag or default path if that call fails), its second every other option, and a failing second call fails the run.
- Your own `reports/mutation-stream.jsonl` is no longer a project input.
- `RunEvent.RunEventDrain.DefaultProgressStreamFile` is removed; read `Configuration.defaultOptions`.
