---
"@systemfsoftware/stryker-js-cli-contract": minor
---

The `stryker` CLI's product contract ships in its own package: the machine-stream events and their stream version, the stock mutator catalog, the span taxonomy and the output-mode header, with the generated JSON Schema documents beside them. A consumer reads the stream, the catalog and the taxonomy from `RunEvent`, `StockCatalog`, `SpanTaxonomy` and `OutputMode` here instead of from `@systemfsoftware/stryker-js`.

The published JSON Schema document states every field a line carries: a `mutant` line's `id`, `file` and `mutator` follow the mutant id, file name and mutator name grammar, and a `verdict` line's `thresholds` and mutant locations are the fixed-field `RunEvent.VerdictThresholds` and `RunEvent.VerdictLocation` structs instead of report shapes admitting arbitrary extra JSON. Every line the wire codec writes is a line the document admits, and it reads each one back unchanged.
