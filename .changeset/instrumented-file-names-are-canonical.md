---
"@systemfsoftware/stryker-js-instrumenter": major
---

File names handed to `instrument` are canonicalized: a backslash in an input path is folded to `/`, in the returned file names and in each mutant's file name alike. A result now reports one spelling of a path, matching the spelling `Mutant.fileName` already used, instead of echoing whatever separator the caller passed.

No call-site change is needed — keep passing plain strings to `instrument`.
