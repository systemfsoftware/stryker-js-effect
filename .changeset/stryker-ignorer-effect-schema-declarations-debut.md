---
"@systemfsoftware/stryker-ignorer-effect-schema-declarations": minor
---

first release: the schema-declaration ignorer as a self-contained package with no peer dependencies — Effect is bundled inside `dist`; migrate by replacing `"@systemfsoftware/stryker-plugins"` with `"@systemfsoftware/stryker-ignorer-effect-schema-declarations"` in `plugins:` (the `ignorers: ["effect-schema-declarations"]` name is unchanged) on `@systemfsoftware/stryker-js-engine` 4.1.0 or later
