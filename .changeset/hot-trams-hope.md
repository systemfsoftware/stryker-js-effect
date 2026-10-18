---
"@systemfsoftware/stryker-js-instrumenter": major
---

Default runs keep more mutants active, so mutation scores and the set of mutants that run change. Under the default `mutator.mutantSetPolicy`, a replacement is no longer Ignored as `equivalent-to-original` or `duplicate-at-site` when its parentheses carry meaning, as in a parenthesised comma sequence `(a, b)` or an object literal arrow body `() => ({})`, and a parenthesis or comma inside a string literal no longer decides whether the replacement's own outer parentheses are stripped. The generated mutants and their ids are unchanged.
