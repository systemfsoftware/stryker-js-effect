# @systemfsoftware/stryker-js-angular

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-js-angular)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-js-angular)

> Covers Angular templates and Vue single-file components — `.html`, `.htm`,
> and `.vue` files — making their embedded scripts first-class mutation
> targets.

Installing the package and listing it in `plugins` is the whole setup.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-js-angular
```

Add the package name to `plugins` in your StrykerJS config:

```ts
import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define({
  testRunner: 'vitest',
  plugins: ['@systemfsoftware/stryker-js-angular'],
  mutate: [
    'src/**/*.html',
    'src/**/*.vue',
  ],
})
```

## What gets mutated

Only script regions are mutated. Each `<script>` in a document — a template may
hold any number of them — is handed to the core's own parser and mutated as
ordinary JavaScript or TypeScript: `type` and `lang` attributes select the
script format, defaulting to JavaScript, and the mutated script is printed back
between the tags it came from at its original offsets.

Template expressions are never parsed, never mutated, and never printed. In a
Vue component holding `<template>{{ count }}</template>` beside a
`<script lang="ts">`, only the script carries mutants.

## Signal APIs

Mutants inside the configuration objects of Angular's `input`, `model`, and
`output` signal functions — and of the signal query functions — break the
Angular compiler. This plugin does not suppress them. Pair it with the ignorer
package:

```ts
ignorers: ['@systemfsoftware/stryker-ignorer-angular'],
```

## Boundaries

- The exported surface is `strykerFrameworks`: one plain `Framework` object
  claiming the `html` format for `.html`, `.htm`, and `.vue`, typed against
  [`@systemfsoftware/stryker-framework-interface`](https://www.npmjs.com/package/@systemfsoftware/stryker-framework-interface).
- The `package.json` declares `"strykerFramework": { "extensions": [".html",
  ".htm", ".vue"] }`: the host reads that field from installed packages to name
  this package in a skip reason without importing the module.
- `angular-html-parser` is a hard dependency, resolved when the module loads —
  there is no peer to install and no version to reconcile.
- There is no bundled ignorer: signal-configuration suppression lives in
  `@systemfsoftware/stryker-ignorer-angular`.

## Contributing

Development setup and workflow: [AGENTS.md](../AGENTS.md).

## License

[Apache 2.0](LICENSE)
