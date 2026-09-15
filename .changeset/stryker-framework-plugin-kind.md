---
"@systemfsoftware/stryker-js-language": minor
"@systemfsoftware/stryker-js-plugin-interface": minor
---

A plugin can now claim a file format. The plugin kinds gain `Framework`, and an
entry of that kind contributes the new `Framework` service from the language
package: the format claim (`formatId`, `extensions`, `language`,
`contractVersion`) and Effect-typed `parse`, `transform`, `print`, and
`disableTypeChecks` hooks. Installing a framework plugin package is the whole
setup — the default `plugins` glob discovers it, so a project whose toolchain
already provides the format needs no engine configuration.
