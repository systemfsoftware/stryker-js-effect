---
"@systemfsoftware/stryker-js": patch
---

Incremental runs keep reusing verdicts for a test that imports a linked workspace package whose manifest declares `exports` with nested conditions, array fallbacks, root conditions without a `.` key or `null` targets. Such a manifest no longer counts as unreadable as a whole: each `exports`, `imports`, `main` and `module` entry is read on its own, and an entry that maps to no file still keeps the closures that import it open.

A condition object now resolves to the file the runtime loads: past `types`, an `import`, `node` or `default` condition is followed, and any other first condition leaves the importers' closures open. A package that lists `types` first no longer keeps a verdict across an edit to its runtime file on a test runner that does not report the modules each test loaded.
