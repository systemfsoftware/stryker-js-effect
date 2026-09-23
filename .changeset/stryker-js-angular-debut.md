---
"@systemfsoftware/stryker-js-angular": minor
---

First release. This is the Angular framework plugin: it claims the HTML template
format for `.html`, `.htm`, and `.vue` files and hands the `script` regions of
those documents to the instrumenter, so mutants land in embedded JavaScript and
TypeScript while template expressions are left untouched.

Signal ignoring is not included: pair the plugin with the
`@systemfsoftware/stryker-ignorer-angular` package to keep the configuration
objects passed to the signal `input`, `model`, and `output` functions — and to
the signal query functions — out of mutation.

Enable the plugin by installing it and adding it to `plugins`; there is no
discovery by package name.

The format's claim carries the version of the HTML parser the plugin resolved
and owns, rather than a fixed constant. Upgrading that parser therefore
invalidates the mutant results an earlier incremental run remembered for the
files this plugin owns, instead of reusing results the new parser never
produced.
