---
"@systemfsoftware/stryker-js-angular": minor
---

First release. This is the Angular framework plugin: it claims the HTML template
format for `.html`, `.htm`, and `.vue` files and hands the `script` regions of
those documents to the instrumenter, so mutants land in embedded JavaScript and
TypeScript while template expressions are left untouched.

The plugin bundles the Angular signal ignore rule as well: configuration objects
passed to the signal `input`, `model`, and `output` functions, and to the signal
query functions, are identity data to the Angular compiler, so mutating them
breaks compilation and they are ignored instead.

Installing the package is the only setup step: the engine's default plugin
discovery finds it, so no configuration entry is needed.

The format's claim carries the version of the HTML parser the plugin resolved
and owns, rather than a fixed constant. Upgrading that parser therefore
invalidates the mutant results an earlier incremental run remembered for the
files this plugin owns, instead of reusing results the new parser never
produced.
