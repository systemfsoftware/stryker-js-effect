[![NPM Version][npm-badge]][npm-url]
[![License: Apache 2.0][license-badge]][license-url]

# @systemfsoftware/stryker-js-html-reporter

HTML reporter plugin for the @systemfsoftware mutation engine.

## Usage

You normally never import this package directly — the CLI binds it as a built-in
in-process reporter. The reporter exists so a programmatic consumer can assemble
its own host:

```ts
import { makeHtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
```

## Related

- [`@systemfsoftware/stryker-js`][engine] — the run engine that emits the events this reporter presents, and the binary that binds `makeHtmlReporter` as a built-in reporter

## License

Licensed under [Apache 2.0][license-url].

[npm-badge]: https://img.shields.io/npm/v/@systemfsoftware/stryker-js-html-reporter?style=flat-square
[npm-url]: https://www.npmjs.com/package/@systemfsoftware/stryker-js-html-reporter
[license-badge]: https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square
[license-url]: https://github.com/systemfsoftware/stryker-js-effect/blob/main/LICENSE
[repo]: https://github.com/systemfsoftware/stryker-js-effect
[engine]: https://github.com/systemfsoftware/stryker-js-effect/tree/main/packages/stryker-js
