---
"@systemfsoftware/stryker-js": patch
---

Incremental runs keep reusing verdicts for a test that imports a linked workspace package whose `package.json` declares `exports` with nested conditions, array fallbacks or `null` targets. Such a manifest no longer counts as unreadable as a whole: each `exports`, `imports`, `main` and `module` entry is read on its own, and an entry that maps to no file still keeps the closures that import it open.
