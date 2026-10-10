---
"@systemfsoftware/stryker-js-cli-contract": minor
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js": major
---

Every machine-stream mutant line now carries `statusReason`. An Ignored line names the rule that removed it as `<rule-id>: <detail>` (for example `arid-logging: Effect.logInfo`); other statuses carry their note or `null`. `stryker merge` keeps the reason in the JSON report.

Breaking:

- The stream `schemaVersion` is now `7.0`. A mutant line without `statusReason`, or an Ignored line whose reason names no known rule, is refused. `stryker merge` refuses a shard stream of another major version, naming both versions.
- `RunEvent.RunMutantTestedEvent` is removed. Decode with `RunEvent.RunMutantTested`, a union of `RunMutantIgnored` and `RunMutantSettled`, and narrow on `status`.
