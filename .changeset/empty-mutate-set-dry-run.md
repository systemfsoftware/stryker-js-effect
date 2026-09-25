---
'@systemfsoftware/stryker-js': patch
---

A run whose `mutate` patterns match no file now finishes successfully instead of stopping with an instrument error. It performs the dry run, writes a mutation report with no files, and passes regardless of `thresholds.break`, the same as upstream StrykerJS. A sharded run whose shard receives no file no longer fails.

Errors reported for the prepare, dry-run, and mutation-testing stages now carry their reason as the error message, so a printed cause no longer shows up as a bare error name.
