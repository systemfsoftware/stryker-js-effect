---
"@systemfsoftware/stryker-js-instrumenter": major
---

Default runs keep more mutants active, so mutation scores and the set of mutants that run change. Under the default `mutator.mutantSetPolicy`, a replacement is no longer Ignored as `equivalent-to-original` or `duplicate-at-site` when its parentheses carry meaning, as in a parenthesised comma sequence `(a, b)` or an object literal arrow body `() => ({})`, or when it differs from another replacement only inside a string literal. The generated mutants and their ids are unchanged.
