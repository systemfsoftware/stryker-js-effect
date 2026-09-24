---
"@systemfsoftware/stryker-js": major
---

A framework plugin that cannot serve refuses the run before any file is instrumented. A missing peer, a peer version outside the plugin's supported range, or an invalid contribution ends the run as a configuration error (exit code 2); a plugin module that crashes on import stays an internal error (exit code 4).

A file whose extension no loaded format claims is skipped instead of failing the run: it is reported with its extension and a reason naming the plugin package to add to `plugins`, and the run continues. A file a loaded format claims but cannot parse still fails the run.
