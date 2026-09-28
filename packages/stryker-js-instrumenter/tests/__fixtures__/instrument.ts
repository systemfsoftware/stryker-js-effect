import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'

export const instrument = Instrument.instrument

export const stockOptions = (
  options: Omit<Instrument.InstrumenterOptions, 'mutators'> & { readonly optInMutations?: readonly string[] },
): Instrument.InstrumenterOptions => {
  const { optInMutations = [], ...rest } = options
  return { ...rest, mutators: Mutator.selectMutators(Mutator.stockRegistry, optInMutations) }
}
