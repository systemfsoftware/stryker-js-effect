import { Instrumenter } from '@systemfsoftware/stryker-js-contracts'
import * as Layer from 'effect/Layer'

import { coreFormatRegistry, registerEntries } from '../Format.js'
import type { FormatRegistry } from '../Format.schema.js'
import { frameworkEntryOf } from '../FrameworkEntry.js'
import { disableTypeChecks, instrument } from '../Instrument.service.js'
import { registryOf, selectMutators } from '../Mutator.service.js'

const claimedFormatsOf = (registry: FormatRegistry): readonly Instrumenter.ClaimedFormat[] =>
  registry.entries.map((entry) => ({
    formatId: entry.claim.formatId,
    ownerModule: entry.owner,
    ownerVersion: entry.ownerVersion,
    language: entry.claim.language,
    extensions: entry.claim.extensions,
  }))

/**
 * Binds the JavaScript instrumenter to a run: the plugins' framework formats
 * join the core formats, and the plugins' mutators and ignorers join every
 * `instrument` call.
 */
export const bind = (inputs: Instrumenter.InstrumenterInputs): Instrumenter.BoundInstrumenter => {
  const registry = registerEntries(
    coreFormatRegistry,
    inputs.plugins.frameworks.map(({ moduleName, framework }) => frameworkEntryOf(moduleName, framework)),
  )
  const mutators = registryOf(inputs.catalogs, inputs.plugins.mutators.map(({ contribution }) => contribution))
  return {
    formats: claimedFormatsOf(registry),
    instrumenter: {
      instrument: (files, selection) =>
        instrument(files, {
          ignorers: [...inputs.plugins.ignorers],
          excludedMutations: [...selection.excludedMutations],
          mutantSetPolicy: selection.mutantSetPolicy,
          mutators: selectMutators(mutators, selection.optInMutations),
        }, registry),
      disableTypeChecks: (file) => disableTypeChecks(file, registry),
    },
  }
}

export const layer: Layer.Layer<Instrumenter.InstrumenterDriver> = Layer.succeed(
  Instrumenter.InstrumenterDriver,
  Instrumenter.InstrumenterDriver.of({ bind }),
)
