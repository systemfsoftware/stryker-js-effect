---
"@systemfsoftware/stryker-js": patch
---

Incremental runs now reuse results for test files that import `#` subpath imports or Node builtins. A `#` import resolves through the `imports` map of the nearest package manifest, choosing among conditions the same way as `exports` does (the `@systemfsoftware/source` condition first). `node:*` imports and every bare name Node lists as a builtin count as external. Before this, either kind of import made Stryker treat the test file as depending on every project file, so any edit invalidated it. A `#` import that the nearest map does not name still does. Wildcard targets in `exports` and `imports` now insert the matched text as written, so a `$&` or `$'` in a subpath is no longer treated as a replacement pattern.
