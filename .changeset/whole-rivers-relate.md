---
"@systemfsoftware/stryker-js-typescript-checker": major
---

The TypeScript checker now ignores a mutant that compares a length with zero in a way that is always true or always false, such as xs.length >= 0 or xs.length < 0, when a kept mutant at the same site already replaces the comparison with true or false. It does so only when the project has strictNullChecks on, the type of xs is an array, a tuple, a string, or a union of only those, and xs is a name, this, or a chain of plain property reads such as box.items. The reason is constant-collection-size followed by the replacement and its constant. Every other comparison is still checked and scored, including one read through a call, an element access, an optional chain or an await, or one against a number other than zero. Mutation scores change because the ignored mutants no longer count. To keep them, remove the TypeScript checker from checkers.
