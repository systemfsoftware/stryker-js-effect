---
"@systemfsoftware/stryker-js": patch
---

`stryker audit` refuses a report whose `files` record holds an empty file name or one containing NUL. The `matrix-undecodable` error names the key; it used to count the entry. On Node 24 and Node 26, it also reads every file name in a report exactly, even after an earlier report in the same run held a file name ending in a backslash (nodejs/node#63785).
