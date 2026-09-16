---
"@systemfsoftware/stryker-js-svelte": minor
---

First release. Svelte support for mutation runs: `.svelte` files are
instrumented, and their mutants are reported under the `svelte` language
instead of `javascript`.

Svelte is an optional peer dependency, and `3.30` is the oldest supported
version — Svelte 5 included, template expressions and all. When no compiler is
installed, or the installed one is older than that, the run stops before
instrumentation and names the peer it needs.

Installing the package is the only setup step.

The format's claim carries the version of the Svelte compiler the plugin
resolved and owns, rather than a fixed constant. Upgrading that compiler
therefore invalidates the mutant results an earlier incremental run remembered
for `.svelte` files, instead of reusing results the new compiler never produced.
