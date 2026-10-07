---
"@systemfsoftware/stryker-js": minor
---

A dry run now records the modules each test file evaluated, and a later incremental run uses them. A test file that loads a module only through a computed dynamic `import()` is keyed to the modules it actually loaded: an edit to one of them re-runs that test file's mutants, while an edit to any file outside them keeps their verdicts. When the runtime target is not a project file, such as a `data:` URL, the test file stays keyed to the whole project and its mutants re-run on any change.
