import * as Metric from 'effect/Metric'

export const checkerDuration = Metric.timer('stryker.checker.duration', {
  description: 'Checker worker RPC duration in milliseconds',
})

export const checkerMutantsChecked = Metric.counter('stryker.checker.mutants.checked', {
  description: 'Total number of mutants a checker worker answered for',
})

export const checkerMutantsSkipped = Metric.counter('stryker.checker.mutants.skipped', {
  description: 'Total number of mutants dropped because they cannot be described to a checker',
})

export const checkerCrashes = Metric.counter('stryker.checker.crashes', {
  description: 'Total number of checker worker calls that failed without being cancelled',
})
