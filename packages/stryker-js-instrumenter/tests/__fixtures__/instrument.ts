import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'

export const instrument = Instrument.instrument

export const stockOptions = (
  options: Omit<Instrument.InstrumenterOptions, 'mutators'>,
): Instrument.InstrumenterOptions => ({
  ...options,
  mutators: Mutator.selectMutators(Mutator.stockRegistry, options.optInMutations ?? []),
})
