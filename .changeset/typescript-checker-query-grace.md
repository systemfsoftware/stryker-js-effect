---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

A type query whose TypeScript server stops answering is no longer left to hang. After a 30 second grace the query is abandoned and its file is refused as `server-crashed`, with advice naming the timeout. The server is discarded, so a file queried after it is answered on a fresh server and one wedged server cannot hold up the queries behind it.
