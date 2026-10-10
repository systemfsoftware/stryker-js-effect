---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-plugin-interface": major
---

Verdicts now live in a verdict store, one entry per verdict keyed by a digest of everything that can change it, so shards, later runs and other branches sharing a store reuse each other's verdicts. The `verdictStore` option picks it: `{ kind: 'fs', directory }` (default `reports/stryker-verdicts`) or `{ kind: 's3', … }`, which needs `@systemfsoftware/stryker-js-verdict-store-s3`. A store that cannot be opened stops the run before testing. Anyone who can write a store can forge verdicts in it.

A store written under another key scheme is a clean miss. A torn entry is skipped and counted as `entryUnreadable`. New entries: `verdict-store` (the store contract), `verdict-store/fs`, `verdict-store/memory`, and `verdict-store/laws` (the laws every store must pass).

Breaking: `incrementalSources` is removed. The incremental file is now version 5; per-mutant verdicts and costs live in the store.
