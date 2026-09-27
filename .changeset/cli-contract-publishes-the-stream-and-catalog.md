---
"@systemfsoftware/stryker-js-cli-contract": minor
---

The `stryker` CLI's product contract ships in its own package: the machine-stream events and the stream version they declare, the stock mutator catalog, the span taxonomy and the output-mode header, with the generated JSON Schema documents beside them. A consumer reads the stream, the catalog and the taxonomy from `RunEvent`, `StockCatalog`, `SpanTaxonomy` and `OutputMode` here instead of from `@systemfsoftware/stryker-js`.
