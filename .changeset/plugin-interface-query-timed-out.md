---
"@systemfsoftware/stryker-js-plugin-interface": minor
---

`TypeQuery.FileRefusedReason` gains `query-timed-out`. A type query whose TypeScript server stops answering partway through is refused with it, so a caller can tell a query that ran past its grace from one whose server crashed (`server-crashed`) or whose file is not in the project (`not-in-project`) without reading the advice text.
