# @systemfsoftware/stryker-js-instrumenter

Parses source files, applies their configured mutators, and produces the mutant set for a mutation run.

## Install

```sh
pnpm add @systemfsoftware/stryker-js-instrumenter
```

## Entry points

- `@systemfsoftware/stryker-js-instrumenter`

## Use

The instrumenter is used internally by the Stryker mutation testing framework to instrument source files with mutant coverage and switching logic. It handles the formats its registry holds: the JavaScript, TypeScript, and TSX script formats are built in.

Any other format arrives as a plugin contribution. A framework plugin contributes a format entry — the extensions it claims plus the hooks that parse, transform, print, and exempt a document — and the run hands the extended registry to the instrumenter:

- [`@systemfsoftware/stryker-js-angular`](https://www.npmjs.com/package/@systemfsoftware/stryker-js-angular) instruments `.html`, `.htm`, and `.vue` files
- [`@systemfsoftware/stryker-js-svelte`](https://www.npmjs.com/package/@systemfsoftware/stryker-js-svelte) instruments `.svelte` files

A file no installed format claims is reported in the run's skipped files instead of failing it.

## License

Apache-2.0. Part of [systemfsoftware](https://github.com/systemfsoftware/stryker-js-effect/tree/main/packages/stryker-js-instrumenter#readme).
