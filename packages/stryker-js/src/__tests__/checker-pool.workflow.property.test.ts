import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Pool from 'effect/Pool'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'

import {
  type CheckerPool,
  type CheckerSlot,
  checkPlans,
  makeCheckerPoolHandle,
} from '../Checker/checker-pool.handle.js'
import type { CheckerCrash, CheckerResourceService } from '../Checker/Checker.handle.js'
import { StageError } from '../Run.schema.js'
import { ChildProcessCrashedError, OutOfMemoryError } from '../Worker.schema.js'

const holds = (conditions: readonly boolean[]) => conditions.every((condition) => condition)

const runPlanOf = (id: string, line: number): Mutant.MutantRunPlan => {
  const mutant = Mutant.Mutant.make({
    id: Mutant.MutantId.make(id),
    fileName: Mutant.CanonicalFileName.make(`src/${id}.ts`),
    mutatorName: Mutant.MutatorName.make(`${id}-mutator`),
    replacement: '',
    location: { start: { line, column: 0 }, end: { line, column: 1 } },
  })
  return {
    plan: 'Run',
    mutant,
    netTime: 0,
    runOptions: {
      timeout: 0,
      disableBail: false,
      activeMutant: mutant,
      sandboxFileName: `src/${id}.ts`,
      mutantActivation: 'runtime',
      reloadEnvironment: false,
    },
  }
}

const passedAnswers = (mutants: readonly Checker.CheckerMutantWire[]): Record<string, Checker.CheckResult> =>
  Object.fromEntries(
    mutants.map((mutant): readonly [string, Checker.CheckResult] => [mutant.id, { status: 'passed' }]),
  )

const singletonGroups = (mutants: readonly Checker.CheckerMutantWire[]): readonly (readonly string[])[] =>
  mutants.map((mutant) => [mutant.id])

const checkerServiceOf = (handlers: {
  readonly group: CheckerResourceService['group']
  readonly check: CheckerResourceService['check']
}): CheckerResourceService => ({ group: handlers.group, check: handlers.check })

const checkerSlotOf = (checkerName: string, checker: CheckerResourceService): CheckerSlot => [{
  checkerName,
  checker,
}]

const checkerSlotPoolOf = <R>(
  size: number,
  acquire: Effect.Effect<CheckerSlot, StageError | CheckerCrash, R>,
): Effect.Effect<CheckerPool, never, R | Scope.Scope> =>
  Pool.make<CheckerSlot, StageError | CheckerCrash, R>({ acquire, size })

const causeTagOf = (stageError: StageError): string =>
  Option.match(
    Option.flatMap(Option.fromNullishOr(stageError.cause), S.decodeUnknownOption(S.Struct({ _tag: S.String }))),
    { onNone: () => 'none', onSome: (decoded) => decoded._tag },
  )

const stageErrorShapeOf = (error: StageError | CheckerCrash) =>
  Match.value(error).pipe(
    Match.tag('StageError', (stageError) => ({
      tag: stageError._tag,
      stage: stageError.stage,
      cause: causeTagOf(stageError),
    })),
    Match.orElse((crash) => ({ tag: crash._tag, stage: 'none', cause: 'none' })),
  )

const crashTagOf = (error: StageError | CheckerCrash): string =>
  Match.value(error).pipe(
    Match.tag('OutOfMemoryError', () => 'OutOfMemoryError'),
    Match.tag('ChildProcessCrashedError', () => 'ChildProcessCrashedError'),
    Match.orElse(() => 'StageError'),
  )

const groupOrderVerdictOf = (reportedIds: string, expectedIds: string) => reportedIds === expectedIds

const poolBoundVerdictOf = (observed: {
  readonly peak: number
  readonly acquires: number
  readonly highestSlot: number
}) => holds([observed.peak === 2, observed.acquires === 2, observed.highestSlot === 2])

const crashVerdictOf = (observed: {
  readonly crashed: string
  readonly crashedAgain: string
  readonly crashTag: string
  readonly secondTag: string
  readonly highestSlot: number
  readonly acquiresGrew: boolean
}) =>
  holds([
    observed.crashed === observed.crashTag,
    observed.crashedAgain === observed.secondTag,
    observed.highestSlot === 2,
    observed.acquiresGrew,
  ])

const breachVerdictOf = (
  observed: { readonly tag: string; readonly stage: string; readonly cause: string },
  breachTag: string,
) => holds([observed.tag === 'StageError', observed.stage === 'mutationTest', observed.cause === breachTag])

const groupPlansOf = (prefix: string, seed: number) => {
  const count = 2 + Math.abs(seed) % 4
  return Array.from({ length: count }, (_, index) => runPlanOf(`${prefix}${index}`, index + 1))
}

const crashOf = (tag: string) =>
  tag === 'OutOfMemoryError'
    ? OutOfMemoryError.make({ pid: 1, exitCode: 137 })
    : ChildProcessCrashedError.make({ pid: 2, exit: { _tag: 'Code', code: 1 }, cause: 'the checker died' })

describe('checker pool', () => {
  it.effect.prop(
    '∀ids_CheckGroups_≡GroupOrder',
    { of: [S.Int], subject: checkPlans },
    (subject, [seed]) =>
      Effect.gen(function*() {
        const plans = groupPlansOf('g', seed)
        const checker = checkerServiceOf({
          group: (_checkerName, mutants) => Effect.succeed(singletonGroups(mutants)),
          check: (_checkerName, mutants) =>
            Effect.sleep(`${2 * (plans.length - plans.findIndex((plan) => plan.mutant.id === mutants[0]?.id))} milli`)
              .pipe(Effect.as(passedAnswers(mutants))),
        })
        const pool = yield* checkerSlotPoolOf(plans.length, Effect.succeed(checkerSlotOf('c', checker)))
        const checked = yield* subject(makeCheckerPoolHandle(pool), plans)
        const reportedIds = checked.passedPlans.map((plan) => plan.mutant.id).join(',')
        return groupOrderVerdictOf(reportedIds, plans.map((plan) => plan.mutant.id).join(','))
      }),
  )

  it.effect.prop(
    '∀seed_CheckerFanOut_⊆PoolBound',
    { of: [S.Int], subject: checkPlans },
    (subject, [seed]) =>
      Effect.gen(function*() {
        const plans = groupPlansOf('f', seed)
        const inFlight = yield* Ref.make(0)
        const peak = yield* Ref.make(0)
        const slotNumbers = yield* Ref.make<ReadonlyArray<number>>([])
        const acquires = yield* Ref.make(0)
        const checkerServiceFor = (slot: number) =>
          checkerServiceOf({
            group: (_checkerName, mutants) => Effect.succeed(singletonGroups(mutants)),
            check: (_checkerName, mutants) =>
              Effect.gen(function*() {
                yield* Ref.update(slotNumbers, (seen) => [...seen, slot])
                const running = yield* Ref.updateAndGet(inFlight, (current) => current + 1)
                yield* Ref.update(peak, (largest) => Math.max(largest, running))
                yield* Effect.sleep('1 milli')
                yield* Ref.update(inFlight, (current) => current - 1)
                return passedAnswers(mutants)
              }),
          })
        const pool = yield* checkerSlotPoolOf(
          2,
          Ref.updateAndGet(acquires, (n) => n + 1).pipe(
            Effect.map((slot) => checkerSlotOf(`slot-${slot}`, checkerServiceFor(slot))),
          ),
        )
        yield* subject(makeCheckerPoolHandle(pool), plans)
        const peakObserved = yield* Ref.get(peak)
        const acquiresObserved = yield* Ref.get(acquires)
        const highestSlot = (yield* Ref.get(slotNumbers)).reduce((largest, slot) => Math.max(largest, slot), 0)
        return poolBoundVerdictOf({ peak: peakObserved, acquires: acquiresObserved, highestSlot })
      }),
  )

  it.effect.prop(
    '∀crash_CheckerSlot_≠Reused',
    { of: [S.Literals(['OutOfMemoryError', 'ChildProcessCrashedError'])], subject: checkPlans },
    (subject, [crashTag]) =>
      Effect.gen(function*() {
        const plans = [runPlanOf('a', 1)]
        const acquires = yield* Ref.make(0)
        const slotNumbers = yield* Ref.make<ReadonlyArray<number>>([])
        const secondTag = crashTag === 'OutOfMemoryError' ? 'ChildProcessCrashedError' : 'OutOfMemoryError'
        const checkerServiceFor = (slot: number) =>
          checkerServiceOf({
            group: (_checkerName, mutants) => Effect.succeed(singletonGroups(mutants)),
            check: () =>
              Effect.andThen(
                Ref.update(slotNumbers, (seen) => [...seen, slot]),
                Effect.fail(crashOf(slot === 1 ? crashTag : secondTag)),
              ),
          })
        const pool = yield* checkerSlotPoolOf(
          1,
          Ref.updateAndGet(acquires, (n) => n + 1).pipe(
            Effect.map((slot) => checkerSlotOf(`slot-${slot}`, checkerServiceFor(slot))),
          ),
        )
        const handle = makeCheckerPoolHandle(pool)
        const crashed = yield* subject(handle, plans).pipe(Effect.flip)
        const acquiresAfterCrash = yield* Ref.get(acquires)
        const crashedAgain = yield* subject(handle, plans).pipe(Effect.flip)
        const acquiresGrew = (yield* Ref.get(acquires)) > acquiresAfterCrash
        const highestSlot = (yield* Ref.get(slotNumbers)).reduce((largest, slot) => Math.max(largest, slot), 0)
        return crashVerdictOf({
          crashed: crashTagOf(crashed),
          crashedAgain: crashTagOf(crashedAgain),
          crashTag,
          secondTag,
          highestSlot,
          acquiresGrew,
        })
      }),
  )

  it.effect.prop(
    '∀breach_CheckerBreach_≡StageError',
    {
      of: [S.Literals(['CheckerFailed', 'CheckerAnsweredUnrequested', 'CheckerSkippedRequested'])],
      subject: checkPlans,
    },
    (subject, [breachTag]) =>
      Effect.gen(function*() {
        const plans = [runPlanOf('a', 1)]
        const checker = checkerServiceOf({
          group: (_checkerName, mutants) => Effect.succeed(singletonGroups(mutants)),
          check: () =>
            Match.value(breachTag).pipe(
              Match.when(
                'CheckerFailed',
                () =>
                  Effect.fail(
                    Checker.CheckerFailed.make({ cause: 'the checker refused', checkerName: 'c', mutantIds: ['a'] }),
                  ),
              ),
              Match.when('CheckerAnsweredUnrequested', () => Effect.succeed({ 'not-requested': { status: 'passed' } })),
              Match.when('CheckerSkippedRequested', () => Effect.succeed({})),
              Match.exhaustive,
            ),
        })
        const pool = yield* checkerSlotPoolOf(1, Effect.succeed(checkerSlotOf('c', checker)))
        const error = yield* subject(makeCheckerPoolHandle(pool), plans).pipe(Effect.flip)
        return breachVerdictOf(stageErrorShapeOf(error), breachTag)
      }),
  )
})
