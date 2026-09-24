---
"@systemfsoftware/stryker-js": major
---

A framework plugin that cannot serve refuses the run before any file is instrumented. A missing peer, a peer installed outside the plugin's supported range, a peer that does not export what the plugin needs, or a contribution that fails validation ends the run as a configuration error (exit code 2); a plugin module that crashes on import stays an internal error (exit code 4).

An unclaimed file is skipped instead of failing the run. The skip report names its extension and the installed package whose manifest claims that extension, so the fix is adding that package to `plugins` — or installing a framework plugin when no installed package declares the extension. A file a loaded format claims but cannot parse still fails the run.
