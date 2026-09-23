# @systemfsoftware/stryker-framework-interface

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-framework-interface)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-framework-interface)

> The framework interface: the plain object a plugin exports to teach the
> instrumenter a file format, and everything that object declares, produces,
> and receives — as types only. The package ships no runtime code.

A framework plugin claims one format and owns everything about it: which
extensions select it, how the file parses into script regions, how those regions
print back into the raw document, and which report language the file carries.
The plugin module exports `strykerFrameworks`, an array of plain objects the host
loads in-process and calls synchronously. This package carries the shapes of that
contract and nothing that runs. It has **no** Effect dependency, runtime or
development: the declaration re-exports the AST vocabulary from
`@systemfsoftware/stryker-ignorer-interface` (declared as a runtime dependency,
so the emitted declaration keeps one physical copy of the recursive `Node`), and
the lint preset bans Effect imports outright.

| Export                     | What it is                                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Framework`                | The object a plugin exports: `{ kind: 'Framework', name, claim, parse, transform, print, disableTypeChecks }` — every hook synchronous                                                                          |
| `FrameworkRefusal`         | What a plugin exports instead when the peer it needs cannot serve: `{ kind: 'FrameworkRefusal', name, reason, peer, detail }` with `reason` `PeerMissing` or `PeerVersionUnsupported`; the host refuses the run |
| `FrameworkContribution`    | `Framework \| FrameworkRefusal` — the element type of `strykerFrameworks`                                                                                                                                       |
| `FrameworkClaim`           | `{ formatId, extensions, language, ownerVersion, contractVersion }` — the extensions the plugin owns, the report language its files carry, the framework runtime it resolved, and the contract it targets       |
| `FrameworkContractVersion` | The contract version this package describes (`'1'`); the host refuses a claim that names any other                                                                                                              |
| `FrameworkParseResult<A>`  | `{ kind: 'Parsed', value } \| { kind: 'ParseFailed', message }` — how `parse` and `disableTypeChecks` report a claimed file that does not parse                                                                 |
| `FormatId`                 | The claimed format's identity — a branded string, so it cannot be transposed with the extension list or the language label beside it                                                                            |
| `ScriptFormat`             | The script vocabulary an embedded region may carry — `js`, `ts`, or `tsx`                                                                                                                                       |
| `EmbeddedDocument`         | A parsed framework file: `{ formatId, rawContent, regions }` — the untouched document plus the script regions the core instruments                                                                              |
| `ScriptRegion`             | One located script inside that document: `{ start, end, isExpression, scriptAst? }`, offsets into the document, never the slice                                                                                 |
| `FrameworkContext`         | The toolkit the core hands a hook: `parseScript`, `transformScript`, `printScript`, `instrumentationHeader` — the core constructs it at hook invocation, the plugin only calls it                               |
| vocabulary                 | the AST vocabulary, re-exported from [`@systemfsoftware/stryker-ignorer-interface`](https://www.npmjs.com/package/@systemfsoftware/stryker-ignorer-interface) — `Node`, `Program`, `Statement`, and every node  |

Everything the package publishes is a type.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-framework-interface
```

## Write a framework plugin

A plugin exports its framework from its entry module, typed against this
package:

```ts
import type { FormatId, Framework, FrameworkContribution } from '@systemfsoftware/stryker-framework-interface'

const html: Framework = {
  kind: 'Framework',
  name: 'html',
  claim: {
    formatId: 'html' as FormatId,
    extensions: ['.html', '.htm', '.vue'],
    language: 'html',
    ownerVersion: '10.12.0',
    contractVersion: '1',
  },
  parse: (rawContent, context) => parseDocument(rawContent, context),
  transform: (document, context) => transformRegions(document, context),
  print: (document, context) => printRegions(document, context),
  disableTypeChecks: (rawContent) => disableInRegions(rawContent),
}

export const strykerFrameworks: readonly FrameworkContribution[] = [html]
```

Users add the plugin package to `plugins` in their StrykerJS config; there is no
discovery by name.

A plugin that needs a peer resolves it when its module is evaluated (top-level
`await import(...)`). When the peer is absent or too old it exports a
`FrameworkRefusal` in place of its framework, and the host refuses the run with
that reason before instrumenting anything. Any other failure while importing
the peer is left to propagate: the host reports it as a plugin that crashed on
import.

`FormatId` is a branded string: a plugin brands its own id once, where it
declares the claim, so the value cannot be transposed with an extension or a
language label downstream.

The claim's `ownerVersion` names the framework runtime the plugin resolved and
owns — the compiler or parser a mutant's printed form has to survive. The host
stamps it into incremental state, so upgrading that runtime invalidates the
mutants an earlier run remembered instead of reusing results the new runtime
never produced.

## Boundaries

This package is the tier both sides depend on and neither side owns:

- the **plugin** imports it to type its framework, its claim, its document, and its hook argument;
- the **instrumenter** imports it to adapt a framework into a registry entry and to construct the `FrameworkContext` it passes at hook invocation;
- the **host** (`@systemfsoftware/stryker-js`) imports it to validate what a plugin module exports under `strykerFrameworks`.

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
