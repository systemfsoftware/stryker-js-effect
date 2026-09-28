import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'

export const instrument = Instrument.instrument

export const stockOptions = (
  options: Omit<Instrument.InstrumenterOptions, 'mutators' | 'mutantSetPolicy'> & {
    readonly optInMutations?: readonly string[]
    readonly mutantSetPolicy?: Instrument.InstrumenterOptions['mutantSetPolicy']
  },
): Instrument.InstrumenterOptions => {
  const { optInMutations = [], mutantSetPolicy = 'default', ...rest } = options
  return { ...rest, mutantSetPolicy, mutators: Mutator.selectMutators(Mutator.stockRegistry, optInMutations) }
}
