import { Sandwich } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import { ResolveConcurrency, resolveConcurrency } from './resolve-concurrency.workflow.js'
import type { PrepareDone } from './run/prepare.cell.js'

const ASSUMED_PARALLELISM = 4

const reportedParallelism = () =>
  Option.filter(
    Option.map(
      Option.liftPredicate(globalThis.navigator, (navigator) => typeof navigator !== 'undefined'),
      (navigator) => navigator.hardwareConcurrency,
    ),
    Predicate.isNumber,
  )

const availableParallelism = () => Option.getOrElse(reportedParallelism(), () => ASSUMED_PARALLELISM)

type ConcurrencyRaw = (typeof ResolveConcurrency)['Encoded']

type ConcurrencyRead = ConcurrencyRaw & { readonly record: PrepareDone }

const readConcurrency = (record: PrepareDone): Effect.Effect<ConcurrencyRead> =>
  Effect.sync(() => ({
    _tag: 'ResolveConcurrency',
    concurrency: record.options.concurrency,
    checkerCount: record.options.checkers.length,
    availableParallelism: availableParallelism(),
    record,
  }))

const announcePercentage = (command: ConcurrencyRaw, total: number, isPercentage: boolean) =>
  Boolean.match(isPercentage, {
    onTrue: () =>
      Effect.logDebug(
        `Computed concurrency ${total} from "${command.concurrency}" based on ${command.availableParallelism} available parallelism.`,
      ),
    onFalse: () => Effect.void,
  })

export const concurrencyCell = Sandwich.named('stryker.concurrency')(readConcurrency)
  .decide(resolveConcurrency)
  .write({
    TestRunnersAndCheckers: (split, command) =>
      Effect.as(
        Effect.andThen(
          announcePercentage(command, split.total, split.isPercentage),
          Effect.logInfo(
            `Creating ${split.checkers} checker process(es) and ${split.testRunners} test runner process(es).`,
          ),
        ),
        { ...command.record, concurrency: { testRunners: split.testRunners, checkers: split.checkers } },
      ),
    TestRunnersOnly: (split, command) =>
      Effect.as(
        Effect.andThen(
          announcePercentage(command, split.total, split.isPercentage),
          Effect.logInfo(`Creating ${split.testRunners} test runner process(es).`),
        ),
        { ...command.record, concurrency: { testRunners: split.testRunners, checkers: 0 } },
      ),
    CommandRejected: (rejected) => Effect.die(rejected),
  })
