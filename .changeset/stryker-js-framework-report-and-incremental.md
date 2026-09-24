---
"@systemfsoftware/stryker-js": major
---

A report now labels each file with the language of the format that owns it, instead of the extension table the core used to carry, so a component a framework plugin claims is reported under that plugin's language.

Incremental runs reuse a file's remembered results only while the owner stamp of the format that owns it is unchanged — the module the format is registered from joined with the version of the framework runtime that plugin resolved. Upgrading either recomputes that file's mutants rather than reusing results the new runtime never produced. A file no loaded format claims is never remembered, so configuring the format that owns it mutates the file on the next run.
