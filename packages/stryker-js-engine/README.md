# `@systemfsoftware/stryker-js-engine`

The Stryker run engine as an Effect library. It exports the host API that
`@systemfsoftware/stryker-js` no longer publishes: `Engine`, `Worker`, `Plugin`,
`Configuration`, `Checker`, `RunEvent`, `Serve`, `Mcp`, `SourceParser`, `GitDiff` and
`ImportClosure`.

Use it to embed a mutation run in an Effect program, or to write a harness around the
engine. To run Stryker or write a config file, use
[`@systemfsoftware/stryker-js`](../stryker-js) instead: its executable, `./config` and
`./promises` need no `effect` of your own.

## Install

```bash
pnpm add @systemfsoftware/stryker-js-engine effect
```

`effect` is a required peer. The engine and its Effect-typed dependencies run on the one
`effect` instance your project installs, so Effects, Layers and errors cross the boundary
without a second copy.

## Usage

```ts
import { NodeRuntime } from '@effect/platform-node'
import { Engine } from '@systemfsoftware/stryker-js-engine'
import * as Effect from 'effect/Effect'

NodeRuntime.runMain(
  Engine.strykerCell({
    mutate: ['src/**/*.ts'],
    testRunner: 'command',
  }).pipe(Effect.provide(Engine.nodePlatformLayer)),
)
```

## License

[Apache-2.0](../../LICENSE)
