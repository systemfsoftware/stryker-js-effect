---
"@systemfsoftware/stryker-js": patch
---

A mutation run now writes its event stream to the `progressStreamFile` set in the Stryker config file. It used to honour only the `--progressStreamFile` flag and otherwise wrote `reports/mutation-stream.jsonl`, which the run did not leave out of the project's inputs: with `progressStreamFile` set in the config, every run saw a changed project and re-ran every mutant. The flag still wins over the config file. If you read the stream from `reports/mutation-stream.jsonl` while your config names another path, read it from the configured path.
