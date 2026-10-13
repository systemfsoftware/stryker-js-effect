---
"@systemfsoftware/stryker-js": major
---

A mutation run streams its events to the config's `progressStreamFile`; the flag still wins. Stream files there or at `reports/mutation-stream.jsonl` no longer make the next run re-run every mutant; output paths match with exact case where Stryker finds the file system tells case apart. An existing non-stream file at the stream path is kept and, like an unwritable one, keeps `--json` output.

Breaking:

- A non-empty config `progressStreamFile` moves a run's stream off `reports/mutation-stream.jsonl`.
- A config function is called once more per run: its first answer sets the stream path (else the flag or default), its second the rest, and a failing second call fails the run. Return the same options on every call.
- Your own `reports/mutation-stream.jsonl` is no longer a project input.
- `RunEvent.RunEventDrain.DefaultProgressStreamFile` is removed; read `Configuration.defaultOptions`.
