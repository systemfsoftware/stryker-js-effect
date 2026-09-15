# @systemfsoftware/stryker-framework-interface

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-framework-interface)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-framework-interface)

> The framework interface: what a plugin that teaches the instrumenter a file
> format declares, produces, and receives — as types only. The package ships no
> runtime code.

A framework plugin claims one format and owns everything about it: which
extensions select it, how the file parses into script regions, how those regions
print back into the raw document, and which report language the file carries.
This package carries the shapes of that contract and nothing that runs. It has
**no** Effect dependency, runtime or development: no value is exported, the
declaration re-exports the AST vocabulary from
`@systemfsoftware/stryker-ignorer-interface` (declared as a runtime dependency,
so the emitted declaration keeps one physical copy of the recursive `Node`), and
the lint preset bans Effect imports outright.

| Export             | What it is                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FormatId`         | The claimed format's identity — a branded string, so it cannot be transposed with the extension list or the language label beside it                                                                                              |
| `ScriptFormat`     | The closed script vocabulary an embedded region may carry — `js`, `ts`, or `tsx` — the format `parseScript` parses a slice as                                                                                                     |
| `FrameworkClaim`   | The claim record: `{ formatId, extensions, language, contractVersion }` — the extensions this plugin owns and the report language its files carry                                                                                 |
| `EmbeddedDocument` | A parsed framework file: `{ formatId, rawContent, regions }` — the untouched document plus the script regions the core instruments                                                                                                |
| `ScriptRegion`     | One located script inside that document: `{ start, end, isExpression, scriptAst? }`, offsets into the document, never the slice                                                                                                   |
| `FrameworkContext` | The toolkit the core hands a hook: `parseScript` (the slice plus the script format it parses as), `transformScript`, `printScript`, `instrumentationHeader` — the core constructs it at hook invocation, the plugin only uses it  |
| vocabulary         | the AST vocabulary, re-exported from [`@systemfsoftware/stryker-ignorer-interface`](https://www.npmjs.com/package/@systemfsoftware/stryker-ignorer-interface) — `Node`, `Program`, `Statement`, and every concrete node interface |

Everything the package publishes is a type.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-framework-interface
```

## Write a framework plugin

A plugin declares its claim, then builds the document the hooks declared by
`@systemfsoftware/stryker-js-language` return, typed against this package:

```ts
import type {
  EmbeddedDocument,
  FormatId,
  FrameworkClaim,
  FrameworkContext,
} from '@systemfsoftware/stryker-framework-interface'

const claim: FrameworkClaim = {
  formatId: 'html' as FormatId,
  extensions: ['.html', '.htm', '.vue'],
  language: 'html',
  contractVersion: '1',
}

const parse = (rawContent: string, context: FrameworkContext): EmbeddedDocument => ({
  formatId: claim.formatId,
  rawContent,
  regions: regionsOf(rawContent, context),
})
```

`FormatId` is a branded string: a plugin brands its own id once, where it
declares the claim, so the value cannot be transposed with an extension or a
language label downstream.

The claim's `contractVersion` names the interface version the plugin was written
against; the engine refuses a contribution whose version it does not support, so
a plugin never drifts silently against a changed contract.

## Boundaries

This package is the tier both sides depend on and neither side owns:

- the **plugin** imports it to type its claim, its document, and its hook argument;
- the **instrumenter** imports it to construct the `FrameworkContext` it passes at hook invocation;
- `@systemfsoftware/stryker-js-language` never imports it — the language types the same shapes structurally, so the contract stays dependency-free in both directions.

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
