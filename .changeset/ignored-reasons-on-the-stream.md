---
"@systemfsoftware/stryker-js-cli-contract": minor
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js": major
---

Every machine-stream mutant line now carries `statusReason`. An Ignored line names the rule that removed it as `<rule-id>: <detail>` (for example `arid-logging: Effect.logInfo`); other statuses carry their note or `null`. `stryker merge` keeps the reason in the JSON report.

Breaking:

- The stream `schemaVersion` is now `8.0`, which also adds the `subsumption` key. A mutant line without `statusReason`, or an Ignored line whose reason names no known rule, is refused. `stryker merge` refuses a shard stream of another major version, naming both versions.
- `RunEvent.RunMutantTestedEvent` carries `statusReason`. Building or decoding an Ignored event whose reason names no ignore rule fails.
- `RunEvent.RunEvent` is a tagged union keyed by `_tag`: use its `cases`, `guards` and `match` to handle each event kind.
