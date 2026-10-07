---
"@systemfsoftware/stryker-js": minor
---

`ImportClosure.analyzeImportClosure` accepts `observedModules`: for each test file, the modules a dry run saw it load. Each one that names an existing file joins that test file's closure. A test file that reaches a computed dynamic `import()` then closes around the files it actually loaded, instead of falling back to the whole project. A key that names no existing file keeps the closure open.
