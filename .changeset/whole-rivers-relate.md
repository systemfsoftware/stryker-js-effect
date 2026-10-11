---
"@systemfsoftware/stryker-js-typescript-checker": major
---

The TypeScript checker now ignores a mutant that compares a length with zero in a way that is always true or always false, such as xs.length >= 0 or xs.length < 0, when the type of xs is an array, a tuple, a string, or a union of only those, and a kept mutant at the same site already replaces the comparison with true or false. The reason is constant-collection-size followed by the replacement and its constant. A receiver of any other type, such as any or { length: number }, and a comparison with any number other than zero, is still checked and scored. Mutation scores change because these mutants no longer count. To keep them, remove the TypeScript checker from checkers.
