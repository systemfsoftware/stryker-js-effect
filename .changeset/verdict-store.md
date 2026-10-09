---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-plugin-interface": major
---

Verdicts now live in a verdict store, one entry per verdict, named by a digest of everything that can change it, so shards, later runs and other branches sharing a store reuse each other's verdicts.

The `verdictStore` option picks the store: `{ kind: 'fs', directory }` (default `reports/stryker-verdicts`) or `{ kind: 's3', bucket, prefix, region, endpoint, forcePathStyle }`, which needs `@systemfsoftware/stryker-js-verdict-store-s3` installed. A store that cannot be opened stops the run before testing. Anyone who can write a store can forge verdicts in it.

The `verdict-store` entry publishes the store contract and `verdict-store/laws` the laws every store must pass.

Breaking: `incrementalSources` is removed; earlier verdicts come from the store.
