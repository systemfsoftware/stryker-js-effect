---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

A type query whose TypeScript server stops answering is no longer left to hang. After a 30 second grace the query is abandoned, its file is refused as `query-timed-out`, and the server is discarded, so a file queried after it is answered on a fresh server and one wedged server cannot hold up the queries behind it. Opening a project that never finishes loading is bounded by the same grace: the request is refused as `project-open-failed` instead of holding up every query for every project.
