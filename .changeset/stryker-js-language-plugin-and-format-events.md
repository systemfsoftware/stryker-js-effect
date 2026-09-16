---
"@systemfsoftware/stryker-js-language": minor
---

the run stream gains three event kinds — the plugin-load report, the resolved
format registry, and the per-file skip report — and `RunFailed` gains an optional
`reason` naming the typed plugin failure that ended the run; the stream schema
version is bumped to `1.1`, and the constant that carries it is published here as
`STREAM_SCHEMA_VERSION`
