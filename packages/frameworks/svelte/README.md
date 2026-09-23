# @systemfsoftware/stryker-js-svelte

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-js-svelte)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-js-svelte)

> Framework plugin that makes Svelte components first-class mutation targets.

Install the package and add it to `plugins`. The `Framework` contribution it
exports — named `svelte` — claims `.svelte` files.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-js-svelte
```

Add the module to `plugins` in your StrykerJS config:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vitest',
  plugins: [
    import.meta.resolve('@systemfsoftware/stryker-js-svelte'),
  ],
  mutate: ['src/**/*.svelte'],
})
```

Svelte itself is an optional peer dependency, installed in the project you
mutate:

```bash
pnpm add -D svelte
```

## What gets mutated

The instance script, the optional module script, and every template expression
Svelte reports are handed to the core's own parser and mutated as ordinary
JavaScript or TypeScript — a `lang="ts"` attribute selects the script format —
and each region is printed back where it came from, so the surrounding
component does not move.

Mutants inside a component are activated by a small header the plugin places in
the component's module script. A component no mutant lands in is left
byte-for-byte alone.

## Missing or old compiler

The compiler is resolved from your project when the plugin module is evaluated,
never from a copy bundled at publish time. The supported range is `>=3.30` (the
`svelte` entry under `peerDependencies`). When no compiler is installed, or the
installed one is older than that range, the plugin exports a refusal naming the
peer instead of its framework, and the run stops before instrumentation as a
configuration error.

Svelte 5 no longer exports a template walker, so Svelte 5 templates are walked
by the plugin's own walker dependency.

## Boundaries

- The package depends inward only: on
  [`@systemfsoftware/stryker-framework-interface`](https://www.npmjs.com/package/@systemfsoftware/stryker-framework-interface)
  and its template-walker dependency. It has no Effect dependency and never
  depends on the instrumenter or the host.

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
