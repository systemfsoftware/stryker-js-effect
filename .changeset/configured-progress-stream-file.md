---
"@systemfsoftware/stryker-js": major
---

A mutation run now writes its event stream to the `progressStreamFile` set in the Stryker config file; before, only the `--progressStreamFile` flag moved it, and the flag still wins. Stream files at the configured path or at `reports/mutation-stream.jsonl` no longer make the next run re-run every mutant, and Stryker's output files are left out of the project however their paths are spelled.

Breaking:

- When your config names `progressStreamFile`, the run's stream is no longer at `reports/mutation-stream.jsonl`; read it from the configured path.
- A config file that exports a function has it called once more per mutation run, so it must return the same options each time without failing.
- A file of your own at `reports/mutation-stream.jsonl` is no longer part of the project Stryker copies and hashes.
