---
"@systemfsoftware/stryker-js": patch
---

Incremental runs keep reusing verdicts for a test that imports a linked workspace package whose manifest declares `exports` with nested conditions, array fallbacks, root conditions without a `.` key or `null` targets. Such a manifest no longer counts as unreadable as a whole: each `exports`, `imports`, `main` and `module` entry is read on its own, and an entry that maps to no file still keeps the closures that import it open.

A condition object now resolves as Node resolves it, skipping conditions Node does not match, and closes its importers' closures only when ESM and CommonJS importers load the same file. A `types`-first or dual `import`/`require` package no longer keeps a stale verdict on a test runner that does not report loaded modules.
