# @systemfsoftware/stryker-js-angular

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-js-angular)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-js-angular)

> Framework plugin that makes Angular templates — and Vue single-file
> components, which keep their script in an HTML `<script>` tag — first-class
> mutation targets.

Installing this package is the only setup step. The default
`@systemfsoftware/stryker-js-*` plugin glob discovers the module, its `Framework`
contribution claims the format, and the bundled ignore rule is selected because
the module that declares it also claims a format.

| Export                 | What it is                                                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strykerPlugins`       | The `Framework` contribution named `angular`: it claims `html` for `.html`, `.htm`, and `.vue`, and reports those files under the `html` language                                            |
| `strykerIgnorers`      | The bundled `angular-signal-io` rule: the configuration objects of `input`, `model`, and `output`, and of the signal query functions, are identity data the Angular compiler needs           |
| `angularFormatService` | The format service, built from the parser version the plugin resolved — `claim`, `parse`, `transform`, `print`, `disableTypeChecks` — for consumers that compose the plugin layer themselves |
| `angularSignalIgnorer` | The ignore rule as the plain `{ name, shouldIgnore }` entry the loader decodes                                                                                                               |

## What gets mutated

Only the script regions of a document are mutated. `<script>` content is handed
to the core's own parser and mutated as ordinary JavaScript or TypeScript —
`type` and `lang` attributes select the script format, defaulting to JavaScript
— and the mutated script is printed back between the tags it came from.

Template expressions are never parsed, never mutated, and never printed. In a
Vue component holding `<template>{{ count }}</template>` beside a
`<script lang="ts">`, the template is left byte-for-byte alone.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-js-angular
```

Then run mutation as usual:

```bash
pnpm stryker run
```

## Boundaries

- The package depends inward only: on the plugin contract, the language
  vocabulary, and the framework interface. It never depends on the instrumenter
  or the engine.
- `angular-html-parser` is a hard dependency, resolved when the module loads —
  there is no peer to install and no version to reconcile.
- The format, the document, and the script regions are typed against
  [`@systemfsoftware/stryker-framework-interface`](https://www.npmjs.com/package/@systemfsoftware/stryker-framework-interface).

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
