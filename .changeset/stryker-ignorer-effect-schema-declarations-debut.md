---
"@systemfsoftware/stryker-ignorer-effect-schema-declarations": minor
---

first release: the schema-declaration ignorer as a standalone package with exactly one runtime dependency (`@systemfsoftware/stryker-ignorer-interface`) and no Effect dependency at all — its node guards are Standard Schema validators from the interface package; migrate by replacing `"@systemfsoftware/stryker-plugins"` with `"@systemfsoftware/stryker-ignorer-effect-schema-declarations"` in `plugins:` (the `ignorers: ["effect-schema-declarations"]` name is unchanged) on `@systemfsoftware/stryker-js-engine` 4.1.0 or later
