# @systemfsoftware/stryker-ignorer-effect-schema-declarations

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](../../../LICENSE)
[![npm version](https://img.shields.io/npm/v/@systemfsoftware/stryker-ignorer-effect-schema-declarations.svg)](https://www.npmjs.com/package/@systemfsoftware/stryker-ignorer-effect-schema-declarations)

> Stop Effect `Schema` declarations from dragging your Stryker mutation score below 100%.

A brand description, a `_tag`, a schema `title` — mutate any of them and the source changes but runtime behavior does not, so no test assertion can ever kill the mutant. Those unkillable mutants sit in your report forever, indistinguishable from real coverage gaps.

This Stryker ignorer filters them out at the AST level, so the score that remains reflects actual executable behavior.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-ignorer-effect-schema-declarations
```

## Setup in `stryker.config.ts`

Add the package name to `ignorers`. Every ignorer the module exports is then active.

```ts
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: {
    plugin: '@systemfsoftware/stryker-js-vitest-runner',
  },
  ignorers: ['@systemfsoftware/stryker-ignorer-effect-schema-declarations'],
})
```

Mutants recognized by the ignorer are reported with status `Ignored`, carrying the exact reason why skipping is safe.

## What It Ignores

| Declaration                                               | Example                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Brand descriptions                                        | `Symbol.for('UserId')`                                                               |
| `TaggedClass` / `TaggedError` tag strings                 | `S.TaggedClass<A>()('Placed', { ... })`                                              |
| `TaggedStruct` tag strings                                | `S.TaggedStruct('PeerMissing', { ... })`                                             |
| Schema property declarations                              | Property definition schema trees in tagged classes                                   |
| `optionalWith` default values                             | `S.optionalWith(S.Number, { default: () => 0 })`                                     |
| `withDecodingDefault` / `withConstructorDefault` defaults | `S.withDecodingDefaultKey(Effect.succeed(true))`                                     |
| Documentation annotations                                 | `identifier`, `description`, `title`, `documentation`, `examples`                    |
| Pure documentation `annotations({ ... })`                 | `S.annotations({ title: 'Amount' })`                                                 |
| Pure documentation `annotate({ ... })`                    | `S.annotate({ identifier: 'PackageExport' })`                                        |
| Filter/check annotation objects                           | `S.makeFilter(pred, { expected: 'a canonical file' })`                               |
| Generation-only declaration callbacks                     | `S.declare(pred, { toCodecArbitrary: () => arbitrary })`                             |
| Arbitrary link transformations                            | `S.link<T>()(S.Null, { decode: …, encode: … })` outside a production `toCodec*` slot |
| Type identity constants                                   | `const TypeId = '…/StageError' as const`                                             |

## What Stays Graded

Everything a mutant can still change at run time stays live: filter predicates and bounds, patterns, literal vocabularies, struct field sets, codec decode/encode transformations, and any object or string a schema uses to decide acceptance. The ignorer only removes mutants whose position cannot change a decoded value, a routing decision, or an encoded value.

## License

[Apache-2.0](../../LICENSE)
