# @systemfsoftware/stryker-js-svelte

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-js-svelte)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-js-svelte)

> Framework plugin that makes Svelte components first-class mutation targets.

Installing this package is the only setup step. The default
`@systemfsoftware/stryker-js-*` plugin glob discovers the module, and the
`Framework` contribution it publishes — named `svelte` — claims the `svelte`
format for `.svelte` files. There is nothing to add to your configuration.

## What gets mutated

The instance script, the optional module script, and every template expression
Svelte reports are handed to the core's own parser and mutated as ordinary
JavaScript or TypeScript — a `lang="ts"` attribute selects the script format —
and each region is printed back where it came from, so the surrounding
component does not move.

Mutants inside a component are activated by a small header the plugin places in
the component's module script. A component no mutant lands in is left
byte-for-byte alone.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-js-svelte
```

Svelte itself is an optional peer dependency, installed in the project you
mutate:

```bash
pnpm add -D svelte
```

## Boundaries

- The package depends inward only: on the plugin contract, the language
  vocabulary, and the framework interface. It never depends on the instrumenter
  or the engine.
- The compiler is resolved from your project when the run prepares, never from a
  copy bundled at publish time. The supported range is the `svelte` entry under
  `peerDependencies`: when no compiler is installed, or the installed one is
  older than that range, the run stops before instrumentation with a
  configuration error naming the peer.
- Svelte 5 no longer exports a template walker, so Svelte 5 templates are walked
  by the plugin's own walker dependency.
- The format, the document, and the script regions are typed against
  [`@systemfsoftware/stryker-framework-interface`](https://www.npmjs.com/package/@systemfsoftware/stryker-framework-interface).

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
