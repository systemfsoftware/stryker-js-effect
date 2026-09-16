---
"@systemfsoftware/stryker-js-engine": major
---

a report now names each file's language after the format that owns it, so a
component a framework plugin claims is reported with that plugin's language
instead of `javascript`, and a report's dependency list no longer mentions karma
or the angular cli; incremental runs reuse a file's remembered results only
while the owner stamp of the format that owns it stays the same — the installed
version of the plugin declaring the format, joined with the version of the
framework runtime that plugin resolved (`0.1.0+5.55.1`) — so upgrading either
the plugin or the runtime it owns recomputes that file's mutants instead of
reusing results the new runtime never produced, and a file no installed format
claimed is never remembered, so installing the format that owns it mutates that
file on the next run
