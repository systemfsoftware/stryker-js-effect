---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-plugin-interface": major
---

Plugin entries in `plugins` and `appendPlugins` are now the entrypoints
themselves, as `file:` URLs, instead of package names Stryker resolved for you.

Stryker resolved every specifier against its own module before, so a plugin the
project had installed was only found when Node happened to walk to the right
`node_modules` from Stryker's location — which is not the project's location for
a global install, an `npx` run, or a strict isolated store. The project now
resolves each plugin itself, in the config module where the project's own
dependencies are visible:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  plugins: [import.meta.resolve('@acme/stryker-runner')],
})
```

The `--plugins` and `--appendPlugins` flags take the same resolved URLs. A value
that is not a `file:` URL is refused with the entry named.

Stryker no longer reports an unresolved specifier as a warning it can continue
past, because it no longer resolves one: a plugin that cannot be loaded stops
the run and names the entry, and a plugin that loads but contributes nothing is
still reported as before.
