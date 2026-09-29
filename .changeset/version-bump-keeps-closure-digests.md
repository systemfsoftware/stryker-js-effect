---
"@systemfsoftware/stryker-js": patch
---

Changing only the version in a package manifest that tests import no longer invalidates the incremental verdicts of those tests, so releasing a package keeps its cached mutation results.
