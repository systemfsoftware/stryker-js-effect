---
"@systemfsoftware/stryker-js-language": major
"@systemfsoftware/stryker-js-plugin-interface": major
---

A plugin can now claim a file format. The plugin kinds gain `Framework`, and an
entry of that kind contributes the new `Framework` service from the language
package: the format claim (`formatId`, `extensions`, `language`, `ownerVersion`,
`contractVersion`), where `ownerVersion` is the version of the framework runtime
the plugin resolved and owns, and Effect-typed `parse`, `transform`, `print`, and
`disableTypeChecks` hooks. Installing a framework plugin package is the whole
setup — the default `plugins` glob discovers it, so a project whose toolchain
already provides the format needs no engine configuration.

A framework refusal is typed: `FrameworkFailed` names its `reason` and, for the
peer refusals, carries the structured detail a host reads without parsing prose —
`peer`, and for an unsupported version also `version` and `supportedRange`. A
framework plugin's contribution layer may fail with that refusal, so
`declarePlugin` accepts the framework layer's error channel instead of demanding
a layer that can never fail.
