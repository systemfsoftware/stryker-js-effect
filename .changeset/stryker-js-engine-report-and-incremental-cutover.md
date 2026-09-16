---
"@systemfsoftware/stryker-js-engine": major
---

a report now names each file's language after the format that owns it, so a
component a framework plugin claims is reported with that plugin's language
instead of `javascript`, and a report's dependency list no longer mentions karma
or the angular cli; incremental runs reuse a file's remembered results only
while the format that owns it and the version of the module declaring that
format stay the same, and a file no installed format claimed is never
remembered, so installing the format that owns it mutates that file on the next
run
