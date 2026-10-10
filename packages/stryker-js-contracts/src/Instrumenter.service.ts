import type { MutatorCatalog, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'

import type { ClaimedFormat, File, InstrumentError, InstrumentResult } from './Instrumenter.schema.js'
import type { LoadedPlugins } from './Plugins.schema.js'

/** Which mutants a run asks for, as data any driver can read. */
export interface MutantSelection {
  readonly optInMutations: readonly string[]
  readonly excludedMutations: readonly string[]
  readonly mutantSetPolicy: Options.MutantSetPolicyType
}

export interface InstrumenterShape {
  readonly instrument: (
    files: readonly File[],
    selection: MutantSelection,
  ) => Effect.Effect<InstrumentResult, InstrumentError>
  readonly disableTypeChecks: (file: File) => Effect.Effect<File, InstrumentError>
}

export interface CatalogTiers {
  readonly entries: ReadonlyArray<{ readonly name: string; readonly tier: MutatorCatalog.TierValue }>
}

/** What a run hands a driver once its plugins are loaded and its mutator catalogs are planned. */
export interface InstrumenterInputs {
  readonly plugins: LoadedPlugins
  readonly catalogs: readonly CatalogTiers[]
}

export interface BoundInstrumenter {
  readonly instrumenter: InstrumenterShape
  readonly formats: readonly ClaimedFormat[]
}

export interface InstrumenterDriverShape {
  readonly bind: (inputs: InstrumenterInputs) => BoundInstrumenter
}

export class InstrumenterDriver extends Context.Service<InstrumenterDriver, InstrumenterDriverShape>()(
  '@systemfsoftware/stryker-js/instrumenter.service/InstrumenterDriver',
) {}
