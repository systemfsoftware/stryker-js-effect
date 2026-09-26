---
"@systemfsoftware/stryker-js": major
---

The CLI no longer checks the Node version at startup or prints an `UnsupportedNodeVersion` message. `engines.node` (`>=24.13.1`) is the only statement of support: on an older Node the CLI crashes on the first Node 24 API it calls.
