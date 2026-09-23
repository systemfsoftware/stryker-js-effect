import { Sandwich } from '@systemfsoftware/effect-cell-types'
import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import { ResolveConcurrency, resolveConcurrency } from './resolve-concurrency.workflow.js'

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

interface ConcurrencyRequest {
  readonly concurrency: number | string | undefined
  readonly checkerCount: number
}

type ConcurrencyRaw = (typeof ResolveConcurrency)['Encoded']

const readConcurrency = (request: ConcurrencyRequest): Effect.Effect<ConcurrencyRaw> =>
  Effect.sync(() => ({
    _tag: 'ResolveConcurrency',
    concurrency: request.concurrency,
    checkerCount: request.checkerCount,
    availableParallelism: availableParallelism(),
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
        { testRunners: split.testRunners, checkers: split.checkers },
      ),
    TestRunnersOnly: (split, command) =>
      Effect.as(
        Effect.andThen(
          announcePercentage(command, split.total, split.isPercentage),
          Effect.logInfo(`Creating ${split.testRunners} test runner process(es).`),
        ),
        { testRunners: split.testRunners, checkers: 0 },
      ),
    CommandRejected: (rejected) => Effect.die(rejected),
  })

export const makeConcurrency = (options: Pick<StrykerOptions, 'checkers' | 'concurrency'>) =>
  concurrencyCell.run({ concurrency: options.concurrency, checkerCount: options.checkers.length })