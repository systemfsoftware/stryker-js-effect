---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-instrumenter": major
---

The built-in reporters, plugin loading and their types are no longer published
from separate entry points on `@systemfsoftware/stryker-js`; import them from
`@systemfsoftware/stryker-js`. The mutant vocabulary — `Mutant`, `Location`,
`Position` and their schemas — is importable only from
`@systemfsoftware/stryker-js-instrumenter`.
