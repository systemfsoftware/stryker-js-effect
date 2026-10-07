---
"@systemfsoftware/stryker-js": patch
---

Import closure analysis now accepts the modules a dry run observed a test file load, and treats each one that names an existing file as an extra root of that test file's closure. A test file whose computed dynamic import could not be resolved statically then closes around the files it actually loaded, so an edit to one of those files still moves the mutant's verdict while an edit to an unrelated file leaves it in place.
