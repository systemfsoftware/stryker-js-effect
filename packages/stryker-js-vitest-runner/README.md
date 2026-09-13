# @systemfsoftware/stryker-js-vitest-runner

Vitest test-runner plugin for Stryker

## Install

```sh
pnpm add @systemfsoftware/stryker-js-vitest-runner 'vitest@>=2.0.0'
```

Those are peer dependencies: this package declares them but does not install them, so one copy is shared with the rest of your project.

## Entry points

- `@systemfsoftware/stryker-js-vitest-runner`
- `@systemfsoftware/stryker-js-vitest-runner/stryker-setup`

## Use

Name the plugin in your Stryker configuration:

```json
{
  "plugins": ["@systemfsoftware/stryker-js-vitest-runner"]
}
```

## API

The public surface ships as this package's type declarations in `dist`; no generated API report is carried in this repository.

## License

Apache-2.0. Part of [systemfsoftware](https://github.com/systemfsoftware/stryker-js-effect#readme).
