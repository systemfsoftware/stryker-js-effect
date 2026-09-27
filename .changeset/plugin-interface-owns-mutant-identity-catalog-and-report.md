---
"@systemfsoftware/stryker-js-plugin-interface": major
---

The plugin contract now owns mutant identity, the mutator catalog and the report. `Mutant` holds the status enum and its subsets, `MutantId`, `MutatorName`, `CanonicalFileName`, `Location`, `Position` and `OpenEndLocation`. `MutatorCatalog` declares a catalog entry and refuses one with no examples, an empty `before` snippet, a duplicated id or name, or a name its provider does not own; `MutatorProvider` declares the `strykerMutators` contribution a mutator plugin exports; and `Report` carries the report contract generated from the pinned upstream `mutation-testing-report-schema` plus this product's fields.

Report mutant ids follow the upstream schema and decode as strings, so a report another tool wrote decodes too; report numbers are finite, so `NaN` and `Infinity` are refused.

Import mutant identity, status, location, catalog and report types from here; the instrumenter and the engine no longer re-export them.
