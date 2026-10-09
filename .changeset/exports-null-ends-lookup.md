---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

The TypeScript checker now treats a `null` in a package's `exports` map the way TypeScript does when it resolves a tsconfig `extends`: a `null` reached inside a condition object or a nested array, or under an active condition such as `types`, excludes the subpath instead of falling through to the next entry. Before, the checker could pick a later entry that TypeScript never loads, so the program digest described a config the program did not use.
