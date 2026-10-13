---
"@systemfsoftware/stryker-js": none
"@systemfsoftware/stryker-js-cli-contract": none
---

No change to the published packages. The `@systemfsoftware/stryker-js` tests now run again when a repository file they read changes, instead of reusing a cached pass. The `@systemfsoftware/stryker-js-cli-contract` tests are never cached; a change to a file they read now counts as a change to them.
