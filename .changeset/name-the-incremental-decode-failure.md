---
"@systemfsoftware/stryker-js": patch
---

A cached incremental report that cannot be decoded now names the decode failure in the run log, so a cache written by an older release says which field the reader refused instead of only that the file could not be parsed.
