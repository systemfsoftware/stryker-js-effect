---
"@systemfsoftware/stryker-js-plugin-interface": minor
"@systemfsoftware/stryker-js-typescript-checker": minor
---

`TypeQuery.TypeQueryRefused.version` is the version of the request that was refused. A request for a version a checker does not serve is refused with that version and reason `unsupported-version`, so a caller reads the version it asked for from the refusal instead of its message. The TypeScript checker answers the same way when it cannot open the requested project.
