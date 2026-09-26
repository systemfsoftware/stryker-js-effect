---
"@systemfsoftware/stryker-js-typescript-checker": patch
"@systemfsoftware/stryker-js": patch
---

The TypeScript checker describes a tsconfig document through the schema that declares the keys it interprets, so an override round-trips the document it was given, and the mutant it cannot describe to a checker carries the canonical file-name brand. The plugin contract, configurations, reports, and exit codes are unchanged.
