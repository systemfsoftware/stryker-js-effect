# @systemfsoftware/stryker-js-svelte

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-js-svelte)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-js-svelte)

> Framework plugin that makes Svelte 5 components first-class mutation targets.

Install the package and add it to `plugins`. The `Framework` contribution it
exports — named `svelte` — claims `.svelte` files.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-js-svelte
```

Add the package name to `plugins` in your StrykerJS config:

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vitest',
  plugins: ['@systemfsoftware/stryker-js-svelte'],
  mutate: ['src/**/*.svelte'],
})
```

Svelte 5 itself is an optional peer dependency (`^5.0.0`), installed in the
project you mutate:

```bash
pnpm add -D svelte
```

## What gets mutated

The instance script, the optional module script, and every template expression
the Svelte 5 compiler reports on the modern AST are handed to the core's own
parser and mutated as ordinary JavaScript or TypeScript — a `lang="ts"`
attribute selects the script format — and each region is printed back where it
came from, so the surrounding component does not move.

Mutants inside a component are activated by a small header the plugin places in
the component's module script. A component no mutant lands in is left
byte-for-byte alone.

## Missing or unsupported compiler

The compiler is resolved from your project when the plugin module is evaluated,
never from a copy bundled at publish time. The supported range is `^5.0.0`
(the `svelte` entry under `peerDependencies`). When no compiler is installed,
when the installed one does not export the `VERSION` string and `parse`
function the plugin needs, or when the installed major version is not 5, the
plugin exports a refusal naming the peer instead of its framework, and the run
stops before instrumentation as a configuration error.

## Boundaries

- The package depends inward only: on
  [`@systemfsoftware/stryker-framework-interface`](https://www.npmjs.com/package/@systemfsoftware/stryker-framework-interface).
  It has no Effect dependency and never depends on the instrumenter or the host.

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
