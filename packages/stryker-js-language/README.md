# @systemfsoftware/stryker-js-language

The mutation-testing language — the capability ports and schemas a mutation
run is built from, with no platform. The Node host that runs a mutation test
lives in `@systemfsoftware/stryker-js-engine`; the interface a plugin
implements to plug into a run lives in `@systemfsoftware/stryker-js-plugin-interface`.

## Install

```sh
pnpm add @systemfsoftware/stryker-js-language
```

## Entry point

One specifier carries the whole vocabulary. The package entry
enumerates every published symbol exactly once — concepts (Checker,
Evaluator, ExitClass, Ignorer, Metrics, Module, Mutant, Report,
ReporterEvent, Run, Schema, TestRunner) are all imported from the root:

```ts
import { Mutant, ReporterEventSchema, StrykerOptionsSchema } from '@systemfsoftware/stryker-js-language'
```

## License

Apache-2.0. Part of [systemfsoftware](https://github.com/systemfsoftware/stryker-js-effect/tree/main/packages/stryker-js-language#readme).
