---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

With OpenTelemetry enabled, each `typescript-checker.compiler.check` span now reports how much compiler work the check took: `typescript.snapshot_updates.count`, `typescript.resplices.count`, `typescript.tce_builds.count`, `typescript.tce.ms` and `typescript.importer_shortcut.count`, versioned by `typescript.counts.schema_version` (currently `1`).
