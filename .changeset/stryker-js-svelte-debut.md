---
"@systemfsoftware/stryker-js-svelte": minor
---

First release. `.svelte` files are instrumented — script blocks and template
expressions — and their mutants are reported under the `svelte` language.

Svelte is an optional peer dependency; `3.30` is the oldest supported version,
Svelte 5 included. The compiler is resolved from your project when the plugin
loads. When no compiler is installed, or the installed one is too old, the run
stops before instrumentation as a configuration error naming the peer.

Enable the plugin by installing it and adding it to `plugins`. Its format carries
the Svelte compiler version it resolved, so upgrading the compiler invalidates the
mutant results an earlier incremental run remembered for `.svelte` files.
