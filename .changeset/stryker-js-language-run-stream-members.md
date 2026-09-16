---
"@systemfsoftware/stryker-js-language": major
---

The run stream carries three more event kinds: the outcome of loading each
configured plugin, the resolved format registry with each claimed extension
mapped to the format and the module that owns it, and the files no installed
format claimed. `STREAM_SCHEMA_VERSION` names the new wire version, so a decoder
that switches over the event kinds must handle the new members before it
upgrades.
