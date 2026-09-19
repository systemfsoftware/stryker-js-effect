import * as Metric from 'effect/Metric'

export const checkerDuration = Metric.timer('stryker.checker.duration', {
  description: 'Checker worker RPC duration in seconds',
})

export const checkerMutantsChecked = Metric.counter('stryker.checker.mutants.checked', {
  description: 'Total number of mutants checked by checker workers',
})

export const checkerMutantsSkipped = Metric.counter('stryker.checker.mutants.skipped', {
  description: 'Total number of mutants skipped by checker due to unparseable wire metadata',
})

export const checkerCrashes = Metric.counter('stryker.checker.crashes', {
  description: 'Total number of checker worker process crashes or communication failures',
})
