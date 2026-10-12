---
"@systemfsoftware/stryker-js": patch
---

The README has a new Known issues entry: on Node 24 (and 26 up to at least 26.7.0), `JSON.parse` can return the wrong object key in a long-lived process that reads Stryker report JSON, tracked upstream as nodejs/node#63785.
