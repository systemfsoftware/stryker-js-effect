import * as Metric from 'effect/Metric'
import * as S from 'effect/Schema'

export class CheckerTelemetry extends S.TaggedClass<CheckerTelemetry>()('CheckerTelemetry', {
  instrument: S.Literals(['duration', 'mutantsChecked', 'mutantsSkipped', 'rpcFailures', 'processCrashes']),
}) {
  static readonly duration = Metric.timer('stryker.checker.duration', {
    description: 'Checker worker RPC duration in milliseconds',
  })

  static readonly mutantsChecked = Metric.counter('stryker.checker.mutants.checked', {
    description: 'Total number of mutants a checker worker answered for',
  })

  static readonly mutantsSkipped = Metric.counter('stryker.checker.mutants.skipped', {
    description: 'Total number of mutants dropped because they cannot be described to a checker',
  })

  static readonly rpcFailures = Metric.counter('stryker.checker.rpc_failures', {
    description: 'Checker worker RPC calls that did not complete, excluding interruptions',
    incremental: true,
  })

  static readonly processCrashes = Metric.counter('stryker.checker.process_crashes', {
    description: 'Checker worker processes that never became usable',
    incremental: true,
  })
}
