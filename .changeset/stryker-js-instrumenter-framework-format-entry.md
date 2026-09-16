---
"@systemfsoftware/stryker-js-instrumenter": minor
---

the format registry can now be extended with a framework plugin's contribution:
`frameworkEntryOf` adapts a `Framework` service into a registry entry whose parse,
transform, print, and disable-type-checks hooks delegate to the service over the
plugin's embedded document, and the AST union gains the embedded-document variant
those entries parse to; a registry entry you build yourself must now declare the
`owner` module of its format and a `transform` hook
