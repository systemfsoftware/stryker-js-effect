---
"@systemfsoftware/stryker-js": patch
---

Incremental runs now reuse results for test files that import `#` subpath imports or Node builtins. A `#` import resolves through the nearest package manifest's `imports` map, `@systemfsoftware/source` condition first, and follows a target that names a builtin or another package. `node:*` and Node's builtin names are external. Before, either import made any edit invalidate the test file.

An `imports` entry Stryker cannot read (`null`, an array, nested conditions) now leaves only its own `#` import unresolved; `exports` and `main` still resolve.

`exports` patterns match as in Node: exact key, then longest prefix, so `./features/*` resolves and beats `./*`. Wildcards insert the matched text literally (`$&` is no longer a replacement pattern). A target with a `.`, `..` or `node_modules` segment after `./` is invalid and stays unresolved.
