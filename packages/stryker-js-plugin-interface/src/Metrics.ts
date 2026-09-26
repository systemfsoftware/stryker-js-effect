import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'

import { Metrics } from './Metrics.schema.js'

const countOf = (mutants: readonly { readonly status: Mutant.MutantStatus }[], status: Mutant.MutantStatus): number =>
  mutants.filter((mutant) => mutant.status === status).length

export const metricsFromMutants = (mutants: readonly { readonly status: Mutant.MutantStatus }[]): Metrics =>
  Metrics.make({
    pending: countOf(mutants, 'Pending'),
    killed: countOf(mutants, 'Killed'),
    timeout: countOf(mutants, 'Timeout'),
    survived: countOf(mutants, 'Survived'),
    noCoverage: countOf(mutants, 'NoCoverage'),
    runtimeErrors: countOf(mutants, 'RuntimeError'),
    compileErrors: countOf(mutants, 'CompileError'),
    ignored: countOf(mutants, 'Ignored'),
  })
