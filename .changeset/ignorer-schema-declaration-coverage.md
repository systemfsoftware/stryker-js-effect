---
"@systemfsoftware/stryker-ignorer-effect-schema-declarations": minor
---

The ignorer recognizes the declaration forms Effect Schema files use today, so far fewer unkillable mutants reach your report. A `TaggedStruct` tag, an `annotate({ identifier, description, title })` object, a filter or check annotation object such as `makeFilter(predicate, { expected })`, a declaration's `toCodecArbitrary` callback and the arbitrary link transformation it returns, a decoding or constructor default, and a `TypeId` identity constant are all reported as `Ignored` now. Predicates, bounds, patterns, literal vocabularies, struct field sets, and codec decode/encode transformations keep being mutated. Each newly recognized form carries its own exported reason constant.
