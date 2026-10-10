---
"@systemfsoftware/stryker-js": major
---

`Engine.Project` is now read-only. Its `files` and `filesToMutate` are `ReadonlyMap<string, ProjectFile>` instead of `MutableHashMap`, so read them with `.get`, `.keys()`, `.values()` and `.size`.
