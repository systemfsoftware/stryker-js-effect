---
"@systemfsoftware/stryker-js": major
---

A report now labels each file's language after the format that owns it, so a component a framework plugin claims is reported under that plugin's language instead of `javascript`.

Incremental runs reuse a file's remembered results only while the owner stamp of the format that owns it is unchanged — the installed version of the plugin declaring the format joined with the version of the framework runtime that plugin resolved. Upgrading either recomputes that file's mutants rather than reusing results the new runtime never produced. A file no loaded format claims is never remembered, so installing the format that owns it mutates the file on the next run.
