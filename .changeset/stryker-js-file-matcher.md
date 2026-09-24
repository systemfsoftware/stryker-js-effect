---
"@systemfsoftware/stryker-js": major
---

`Engine.strykerCell` now leaves the Node platform services to the caller, `createFileMatcher` and `matchesFile` are replaced by `Configuration.FileMatcher`, and the entry point no longer re-exports `effect/Schema` as `S`.

- Build a matcher with `FileMatcher.make({ pattern, allowHiddenFiles })` and call `matcher.matches(pathService, fileName)`.
- Import `effect/Schema` directly where you used `S`.
- Provide `Engine.nodePlatformLayer` to `Engine.strykerCell`, for example with `Effect.provide`.
