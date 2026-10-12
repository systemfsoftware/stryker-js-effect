---
"@systemfsoftware/stryker-js": patch
---

The run-inputs digest now hashes only the mutated project's own dependency closure from `pnpm-lock.yaml` (its importer, its ancestor importers, linked workspace importers, and the snapshots and package entries they reach) plus the hoisting settings and `packageManager`, so a lockfile edit outside a project's dependencies keeps its saved verdicts. Other lockfiles, and a `pnpm-lock.yaml` the digest cannot use, still hash the whole file, and the unusable case logs one warning naming the reason. Canonical JSON now orders keys by code unit. The incremental cache version moves to 6, so the first run after upgrading re-tests every mutant once.
