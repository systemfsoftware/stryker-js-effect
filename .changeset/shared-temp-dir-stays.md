---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-cli-contract": minor
---

Runs that share a temp directory no longer break each other. A run that cleans up now removes only its own sandbox and leaves the temp directory (`.stryker-tmp` by default) in place. Before, a run that found the temp directory empty deleted it, so a second run sharing that directory, either in the same process or in the same project at the same time, could fail to create its sandbox or crash during its own cleanup. An empty temp directory now stays in the project after a run; add it to `.gitignore` if it is not ignored already. The span taxonomy drops `stryker.sandbox.remove_empty_parent`, which no run emits any more.
