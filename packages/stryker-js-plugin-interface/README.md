# @systemfsoftware/stryker-js-plugin-interface

The plugin interface of the mutation-testing language — how a checker,
test-runner, reporter, ignorer, or evaluator declares itself to a mutation run
(`declarePlugin`) and how the run composes those contributions
(`composePlugins`). The concept modules those plugins implement live in
`@systemfsoftware/stryker-js-language`.

## Install

```sh
pnpm add @systemfsoftware/stryker-js-plugin-interface
```

## Entry point

One specifier carries the whole interface. The package entry enumerates every
published symbol exactly once — plugin kinds and contributions
(`PluginKind`, `PluginContribution`, `declarePlugin`), composition
(`composePlugins`, `ComposedPlugins`), and the environment a plugin's layer
may require (`RunConfiguration`, `SandboxDirectory`, `PluginEnvironment`):

```ts
import { composePlugins, declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'
```

## License

Apache-2.0. Part of [systemfsoftware](https://github.com/systemfsoftware/stryker-js-effect/tree/main/packages/stryker-js-plugin-interface#readme).
