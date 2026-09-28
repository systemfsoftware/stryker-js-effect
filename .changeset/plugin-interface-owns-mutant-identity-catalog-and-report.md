---
"@systemfsoftware/stryker-js-plugin-interface": major
---

The plugin contract now owns mutant identity, the mutator catalog and the report. `Mutant` holds the status enum and its subsets, `MutantId`, `MutatorName`, `CanonicalFileName`, `Location`, `Position` and `OpenEndLocation`; `MutatorProvider` declares the `strykerMutators` contribution a mutator plugin exports, and `MutatorCatalog` refuses an entry with no examples, an empty `before` snippet, a duplicated id or name, or a name its provider does not own. `Report` carries the contract generated from the pinned `mutation-testing-report-schema` plus this product's fields: its mutant ids follow that schema and decode as strings, so another tool's report decodes too, and its numbers are finite, refusing `NaN` and `Infinity`. `Location` and `OpenEndLocation` decode from a plain `{ start, end }` struct, so a JSON Schema document derived from them states the position fields rather than empty.
