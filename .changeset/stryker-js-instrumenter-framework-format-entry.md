---
"@systemfsoftware/stryker-js-instrumenter": major
---

The format registry can now be extended with a framework plugin's contribution:
`frameworkEntryOf` adapts a `Framework` into a registry entry whose parse,
transform, print, and disable-type-checks hooks delegate to the plugin over its
embedded document, and the AST union gains the embedded-document variant those
entries parse to.

A registry entry you build yourself must now declare the `owner` module of its
format, the `ownerVersion` incremental state keys on, and a `transform` hook; an
entry without them no longer type-checks.
