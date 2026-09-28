## 0.1.0

### Minor Changes

- The `stryker` CLI's product contract ships in its own package: the machine-stream events and the stream version they declare, the stock mutator catalog, the span taxonomy and the output-mode header, with the generated JSON Schema documents beside them. A consumer reads the stream, the catalog and the taxonomy from `RunEvent`, `StockCatalog`, `SpanTaxonomy` and `OutputMode` here instead of from `@systemfsoftware/stryker-js`.

  The published `contract/stream.schema.json` states every field a line carries: a `mutant` line's `id`, `file` and `mutator` follow the mutant id, file name and mutator name grammar, and a `verdict` line's `thresholds` and mutant locations are the fixed-field `RunEvent.VerdictThresholds` and `RunEvent.VerdictLocation` structs instead of report shapes that admit a record of arbitrary extra JSON. A line the document admits is a line the wire codec reads back unchanged, and every line the codec writes is one the document admits.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-plugin-interface@11.0.0
