---
"@systemfsoftware/stryker-js-svelte": minor
---

First release. `.svelte` files are instrumented — script blocks and template
expressions on the Svelte 5 modern AST — and their mutants are reported under
the `svelte` language.

Svelte 5 is an optional peer dependency (`^5.0.0`). The compiler is resolved
from your project when the plugin loads. When no compiler is installed, when
it exports no usable compiler surface, or when the installed major version is
not 5, the run stops before instrumentation as a configuration error naming
the peer.

Enable the plugin by installing it and adding it to `plugins`. Its format
carries the Svelte compiler version it resolved, so upgrading the compiler
invalidates the mutant results an earlier incremental run remembered for
`.svelte` files.
