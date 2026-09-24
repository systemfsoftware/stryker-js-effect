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

export const checkerRpcFailures = Metric.counter('stryker.checker.rpc_failures', {
  description: 'Checker worker RPC calls that did not complete, excluding interruptions',
  incremental: true,
})

export const checkerProcessCrashes = Metric.counter('stryker.checker.process_crashes', {
  description: 'Checker worker processes that never became usable',
  incremental: true,
})
