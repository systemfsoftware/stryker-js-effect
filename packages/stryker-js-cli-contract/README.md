# @systemfsoftware/stryker-js-cli-contract

The Stryker CLI **product contract**. It is implementation-free: nothing here
imports the CLI, and the CLI imports everything here. The machine stream the
`stryker` executable writes, the version that stream declares, the stock mutator
catalog and the span taxonomy are all defined once, in this package, and the
published JSON Schema documents are generated from those definitions.

## Install

```sh
pnpm add @systemfsoftware/stryker-js-cli-contract
```

## Entry point

The package groups its exports into namespaces. `RunEvent` holds the machine
stream: the `RunEvent` union of every event kind the CLI emits, each event's
class, the `RunEventWireLine` newline-delimited JSON codec a consumer decodes
stdout with, and `StreamSchemaVersion`. `OutputMode` holds the output mode and
its signal (`OutputMode`, `ModeSignal`) as the stream header carries them.
`StockCatalog` holds the stock mutator catalog and its name vocabulary
(`StockCatalog`, `StockMutatorName`, `StockDefaultName`, `StockOptInName`).

```ts
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'

const decoded = Schema.decodeUnknownResult(RunEvent.RunEventWireLine)(line)
```

## Published documents

The package commits the documents generated from its contracts and exports them
as subpaths, so a consumer can validate against the same bytes the contract
declares:

- `@systemfsoftware/stryker-js-cli-contract/contract/stream.schema.json` — the
  JSON Schema of the `RunEvent` union.
- `@systemfsoftware/stryker-js-cli-contract/contract/stock-catalog.json` — the
  stock catalog entries.

Run `pnpm --filter @systemfsoftware/stryker-js-cli-contract generate:contract`
to regenerate them; a version guard fails an incompatible change until the
package's version is bumped.

## License

Apache-2.0. Part of [systemfsoftware](https://github.com/systemfsoftware/stryker-js-effect/tree/main/packages/stryker-js-cli-contract#readme).
