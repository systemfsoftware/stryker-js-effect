---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

A tsconfig `extends` that resolves through a package `exports` fallback array now uses the first listed file that exists, as TypeScript does. A `null` entry, including one inside a nested array, ends the whole list: files listed before it are still tried, files after it are not. Previously only the first listed file was considered, so when that file was absent the extended compiler options were dropped.
