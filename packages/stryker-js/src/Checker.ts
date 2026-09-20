/**
 * Checker — the Checker capability.
 *
 * Owns the checker port, its contract, the child-process edge, and the
 * Cell pipelines that drive a checker through a pure workflow. A checker
 * speaks `Mutant`; the engine schedules `MutantRunPlan` — this module bridges
 * the two and verifies the join.
 */

import { Cell } from '@systemfsoftware/effect-cell-types'
import type { FileDescriptions, RunPlan as MutantRunPlan } from '@systemfsoftware/stryker-js-instrumenter'
import {
  CheckerFailed,
  CheckerMutantWire,
  CheckerRpcs,
  type CheckResult,
  type StrykerOptions,
} from '@systemfsoftware/stryker-js-plugin-interface'

import { encodeWorkerOptions } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Metric from 'effect/Metric'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Scope from 'effect/Scope'
import {
  admitCheckerAnswer,
  CheckerAnsweredUnrequested,
  CheckerCommand,
  type CheckerContractBroken,
  type CheckerDecision,
  CheckerSkippedRequested,
  type CheckGroupDecision,
  type CheckResultDecision,
} from './admit-checker-answer.workflow.js'
import { type UndescribableMutant, wireRecordOf } from './checker-mutant-wire.js'
import {
  checkerDuration,
  checkerMutantsChecked,
  checkerMutantsSkipped,
  checkerProcessCrashes,
  checkerRpcFailures,
} from './metrics.js'
import type { IdGeneratorShape } from './Worker.js'
import { ChildProcessCrashedError, OutOfMemoryError } from './Worker.schema.js'
import type { ChildProcessCrashedError as ChildProcessCrashedErrorType } from './Worker.schema.js'
import { makeWorkerClient, WorkerLauncher } from './WorkerLauncher.js'

export type CheckerCrash = ChildProcessCrashedErrorType | OutOfMemoryError
export type { CheckerContractBroken }

/**
 * A checker held by the pool.
 *
 * The pool must be able to interrupt a checker mid-call when the run is
 * cancelled, so the port uses Effect, which can be interrupted, where a Promise
 * cannot. The error channel names both crash variants rather than `unknown`,
 * which lets the retry combinator prove it handles every one of them.
 */
export interface CheckerResourceService {
  readonly check: (
    checkerName: string,
    mutants: readonly CheckerMutantWire[],
  ) => Effect.Effect<Record<string, CheckResult>, CheckerCrash | CheckerFailed>
  readonly group: (
    checkerName: string,
    mutants: readonly CheckerMutantWire[],
  ) => Effect.Effect<readonly (readonly string[])[], CheckerCrash | CheckerFailed>
}

// ---------------------------------------------------------------------------
// Pure contract joins (over MutantRunPlan — the engine's scheduling type)
// ---------------------------------------------------------------------------

/**
 * Pair a checker's answers back to the run plans they were asked about.
 *
 * A checker's port speaks `Mutant`; the engine schedules `MutantRunPlan`. Going
 * one way is a projection, but coming back is a join that can fail two ways —
 * the checker answered about something it was not asked about, or it did not
 * answer about something it was. Both are the plugin breaking its contract, and
 * each carries its own tag, so a caller matches on the failure rather than
 * parsing ids out of a message.
 *
 * Pure: the pairing is a decision over two lists, so it runs without a checker,
 * a process or a clock — which is the point, because this is the part worth
 * testing.
 */
export const pairCheckResults = (
  checkerName: string,
  plans: readonly MutantRunPlan[],
  answers: Readonly<Record<string, CheckResult>>,
): Result.Result<readonly (readonly [MutantRunPlan, CheckResult])[], CheckerContractBroken> =>
  Match.value(partitionAnswers(plansById(plans), answers)).pipe(
    Match.when(
      (partition: AnswerPartition) => partition.unrequested.length > 0,
      (partition) =>
        Result.fail(
          CheckerAnsweredUnrequested.make({
            checkerName,
            phase: 'check',
            unrequestedIds: [...partition.unrequested],
            requestedIds: plans.map((plan) => plan.mutant.id),
          }),
        ),
    ),
    Match.orElse((partition) => admitAnsweredPlans(checkerName, plans, partition.paired)),
  )

/**
 * Resolve a checker's id groups back to run plans.
 *
 * Same join as `pairCheckResults` and the same two failures, over groups rather
 * than single answers. A mutant absent from every group is as much a dropped
 * mutant as one absent from the check results — it would go on to be scheduled
 * as though the checker had approved it.
 */
export const pairGroups = (
  checkerName: string,
  plans: readonly MutantRunPlan[],
  idGroups: readonly (readonly string[])[],
): Result.Result<readonly (readonly MutantRunPlan[])[], CheckerContractBroken> =>
  Match.value(partitionGroups(plansById(plans), idGroups)).pipe(
    Match.when(
      (partition: GroupPartition) => partition.unrequested.length > 0,
      (partition) =>
        Result.fail(
          CheckerAnsweredUnrequested.make({
            checkerName,
            phase: 'group',
            unrequestedIds: [...partition.unrequested],
            requestedIds: plans.map((plan) => plan.mutant.id),
          }),
        ),
    ),
    Match.orElse((partition) => admitGroupedPlans(checkerName, plans, partition)),
  )

interface AnswerPartition {
  readonly paired: readonly (readonly [MutantRunPlan, CheckResult])[]
  readonly unrequested: readonly string[]
}

interface IdGroupPartition {
  readonly plans: readonly MutantRunPlan[]
  readonly grouped: ReadonlySet<string>
  readonly unrequested: readonly string[]
}

interface GroupPartition {
  readonly groups: readonly (readonly MutantRunPlan[])[]
  readonly grouped: ReadonlySet<string>
  readonly unrequested: readonly string[]
}

const plansById = (plans: readonly MutantRunPlan[]): ReadonlyMap<string, MutantRunPlan> =>
  new Map(plans.map((plan): readonly [string, MutantRunPlan] => [plan.mutant.id, plan]))

const missingPlanIds = (plans: readonly MutantRunPlan[], present: ReadonlySet<string>): readonly string[] =>
  plans.map((plan) => plan.mutant.id).filter((id) => !present.has(id))

const answeredPlanIds = (
  paired: readonly (readonly [MutantRunPlan, CheckResult])[],
): ReadonlySet<string> => new Set(paired.map(([plan]) => plan.mutant.id))

const partitionAnswers = (
  byId: ReadonlyMap<string, MutantRunPlan>,
  answers: Readonly<Record<string, CheckResult>>,
): AnswerPartition => {
  const entries = Object.entries(answers).map(([id, answer]) => ({
    id,
    answer,
    plan: Option.fromUndefinedOr(byId.get(id)),
  }))
  return {
    paired: entries.flatMap((entry) =>
      Option.match(entry.plan, {
        onNone: (): readonly (readonly [MutantRunPlan, CheckResult])[] => [],
        onSome: (plan): readonly (readonly [MutantRunPlan, CheckResult])[] => [[plan, entry.answer] as const],
      })
    ),
    unrequested: entries.flatMap((entry) =>
      Option.match(entry.plan, {
        onNone: (): readonly string[] => [entry.id],
        onSome: (): readonly string[] => [],
      })
    ),
  }
}

const admitAnsweredPlans = (
  checkerName: string,
  plans: readonly MutantRunPlan[],
  paired: readonly (readonly [MutantRunPlan, CheckResult])[],
): Result.Result<readonly (readonly [MutantRunPlan, CheckResult])[], CheckerContractBroken> =>
  Match.value(missingPlanIds(plans, answeredPlanIds(paired))).pipe(
    Match.when(
      (missing: readonly string[]) => missing.length > 0,
      (missing) =>
        Result.fail(
          CheckerSkippedRequested.make({ checkerName, phase: 'check', missingIds: [...missing] }),
        ),
    ),
    Match.orElse(() => Result.succeed(paired)),
  )

const partitionGroupIds = (
  byId: ReadonlyMap<string, MutantRunPlan>,
  idGroup: readonly string[],
): IdGroupPartition => {
  const entries = idGroup.map((id) => ({ id, plan: Option.fromUndefinedOr(byId.get(id)) }))
  return {
    plans: entries.flatMap((entry) =>
      Option.match(entry.plan, {
        onNone: (): readonly MutantRunPlan[] => [],
        onSome: (plan): readonly MutantRunPlan[] => [plan],
      })
    ),
    grouped: new Set(idGroup),
    unrequested: entries.flatMap((entry) =>
      Option.match(entry.plan, {
        onNone: (): readonly string[] => [entry.id],
        onSome: (): readonly string[] => [],
      })
    ),
  }
}

const partitionGroups = (
  byId: ReadonlyMap<string, MutantRunPlan>,
  idGroups: readonly (readonly string[])[],
): GroupPartition => {
  const parts = idGroups.map((idGroup) => partitionGroupIds(byId, idGroup))
  return {
    groups: parts.map((part) => part.plans),
    grouped: new Set(parts.flatMap((part) => [...part.grouped])),
    unrequested: parts.flatMap((part) => part.unrequested),
  }
}

const admitGroupedPlans = (
  checkerName: string,
  plans: readonly MutantRunPlan[],
  partition: GroupPartition,
): Result.Result<readonly (readonly MutantRunPlan[])[], CheckerContractBroken> =>
  Match.value(missingPlanIds(plans, partition.grouped)).pipe(
    Match.when(
      (missing: readonly string[]) => missing.length > 0,
      (missing) =>
        Result.fail(
          CheckerSkippedRequested.make({ checkerName, phase: 'group', missingIds: [...missing] }),
        ),
    ),
    Match.orElse(() => Result.succeed(partition.groups)),
  )

// ---------------------------------------------------------------------------
// Child-process edge
// ---------------------------------------------------------------------------

export const makeCheckerChildProcess = (params: {
  readonly options: StrykerOptions
  readonly fileDescriptions: FileDescriptions
  readonly workerEntrypoint: string
  readonly workingDirectory: string
  readonly execArgv: readonly string[]
  readonly idGenerator: IdGeneratorShape
}): Effect.Effect<
  CheckerResourceService,
  CheckerCrash,
  Scope.Scope | WorkerLauncher
> =>
  Effect.gen(function*() {
    const crashed = (cause: string): ChildProcessCrashedError =>
      ChildProcessCrashedError.make({ pid: 0, exit: { _tag: 'Code', code: 1 }, cause })

    const optionsJson = yield* encodeWorkerOptions(params.options)
    const client = yield* makeWorkerClient({
      rpcs: CheckerRpcs,
      entrypoint: params.workerEntrypoint,
      workingDirectory: params.workingDirectory,
      execArgv: [...params.execArgv],
      optionsJson,
      tempDirPrefix: 'stryker-checker-',
    }).pipe(
      Effect.mapError((error) =>
        Match.value(error).pipe(
          Match.tag('ChildProcessCrashedError', 'OutOfMemoryError', (crash) => crash),
          Match.tag(
            'WorkerBootTimeoutError',
            () =>
              crashed(`Checker worker failed to start: its boot window closed before it accepted the RPC connection`),
          ),
          Match.exhaustive,
        )
      ),
      Effect.tapError(() => Metric.update(checkerProcessCrashes, 1)),
    )

    const recordCheckerCall = <A>(
      spanName: string,
      checkerName: string,
      mutants: readonly CheckerMutantWire[],
      call: Effect.Effect<A, CheckerFailed | { readonly message: string }>,
    ): Effect.Effect<A, CheckerCrash | CheckerFailed> =>
      call.pipe(
        Effect.withSpan(spanName, {
          attributes: {
            'stryker.checker.name': checkerName,
            'stryker.mutants.count': mutants.length,
          },
        }),
        Effect.timed,
        Effect.onExit((exit) =>
          Match.value(exit).pipe(
            Match.tag('Success', () => Metric.update(checkerMutantsChecked, mutants.length)),
            Match.tag('Failure', (failure) =>
              Match.value(Cause.hasInterruptsOnly(failure.cause)).pipe(
                Match.when(true, () => Effect.void),
                Match.orElse(() => Metric.update(checkerRpcFailures, 1)),
              )),
            Match.exhaustive,
          )
        ),
        Effect.tap(([duration]) => Metric.update(checkerDuration, duration)),
        Effect.map(([, result]) => result),
        Effect.mapError((error) =>
          Match.value(error).pipe(
            Match.tag('CheckerFailed', (failed) => failed),
            Match.orElse((e) => crashed(e.message)),
          )
        ),
      )

    return {
      check: (checkerName: string, mutants: readonly CheckerMutantWire[]) =>
        recordCheckerCall(
          'stryker.checker.check',
          checkerName,
          mutants,
          client.check({ checkerName, mutants: [...mutants] }),
        ),
      group: (checkerName: string, mutants: readonly CheckerMutantWire[]) =>
        recordCheckerCall(
          'stryker.checker.group',
          checkerName,
          mutants,
          client.group({ checkerName, mutants: [...mutants] }),
        ),
    }
  })

export const createCheckerFactory = (
  options: StrykerOptions,
  fileDescriptions: FileDescriptions,
  workerEntrypoint: string,
  idGenerator: IdGeneratorShape,
  workingDirectory: string,
): Effect.Effect<
  CheckerResourceService,
  CheckerCrash,
  Scope.Scope | WorkerLauncher
> =>
  makeCheckerChildProcess({
    options,
    fileDescriptions,
    workerEntrypoint,
    workingDirectory,
    execArgv: [
      ...Match.value(options.checkers[0]?.nodeArgs).pipe(
        Match.when(Match.undefined, () => options.checkerNodeArgs),
        Match.orElse((args) => args),
      ),
    ],
    idGenerator,
  })

// ---------------------------------------------------------------------------
// Cell write joins (checker decision ↔ run plans)
// ---------------------------------------------------------------------------

type DecidedAnswer = CheckResultDecision['pairs'][number]

const writeDecidedAnswers = (
  plans: readonly MutantRunPlan[],
  checkerName: string,
  answers: readonly DecidedAnswer[],
): Effect.Effect<readonly (readonly [MutantRunPlan, CheckResult])[], CheckerContractBroken> =>
  Effect.fromResult(
    pairCheckResults(
      checkerName,
      plans,
      Object.fromEntries(answers.map((answer): readonly [string, CheckResult] => [answer.id, answer.result])),
    ),
  )

const writeDecidedGroups = (
  plans: readonly MutantRunPlan[],
  checkerName: string,
  idGroups: readonly (readonly string[])[],
): Effect.Effect<readonly (readonly MutantRunPlan[])[], CheckerContractBroken> =>
  Effect.fromResult(pairGroups(checkerName, plans, idGroups))

const writeCheckerDecision = (
  plans: readonly MutantRunPlan[],
  checkerName: string,
  decision: CheckerDecision,
): Effect.Effect<readonly (readonly [MutantRunPlan, CheckResult])[], CheckerContractBroken> =>
  Match.value(decision).pipe(
    Match.tag('CheckResultDecision', (d: CheckResultDecision) => writeDecidedAnswers(plans, checkerName, d.pairs)),
    Match.tag(
      'CheckGroupDecision',
      () => Effect.fail(CheckerSkippedRequested.make({ checkerName, phase: 'check', missingIds: [] })),
    ),
    Match.exhaustive,
  )

const writeCheckerOutcome = (
  plans: readonly MutantRunPlan[],
  checkerName: string,
  outcome: Result.Result<CheckerDecision, CheckerContractBroken>,
): Effect.Effect<readonly (readonly [MutantRunPlan, CheckResult])[], CheckerContractBroken> =>
  Result.match(outcome, {
    onFailure: (error) => Effect.fail(error),
    onSuccess: (decision) => writeCheckerDecision(plans, checkerName, decision),
  })

const writeGroupDecision = (
  plans: readonly MutantRunPlan[],
  checkerName: string,
  decision: CheckerDecision,
): Effect.Effect<readonly (readonly MutantRunPlan[])[], CheckerContractBroken> =>
  Match.value(decision).pipe(
    Match.tag('CheckGroupDecision', (d: CheckGroupDecision) => writeDecidedGroups(plans, checkerName, d.groups)),
    Match.tag('CheckResultDecision', () =>
      Effect.fail(CheckerSkippedRequested.make({ checkerName, phase: 'group', missingIds: [] }))),
    Match.exhaustive,
  )

const writeGroupOutcome = (
  plans: readonly MutantRunPlan[],
  checkerName: string,
  outcome: Result.Result<CheckerDecision, CheckerContractBroken>,
): Effect.Effect<readonly (readonly MutantRunPlan[])[], CheckerContractBroken> =>
  Result.match(outcome, {
    onFailure: (error) => Effect.fail(error),
    onSuccess: (decision) => writeGroupDecision(plans, checkerName, decision),
  })

// ---------------------------------------------------------------------------
interface PartitionedMutants {
  readonly wire: readonly CheckerMutantWire[]
  readonly undescribable: readonly UndescribableMutant[]
}

const partitionMutantsForWire = (plans: readonly MutantRunPlan[]): PartitionedMutants => {
  const wire: CheckerMutantWire[] = []
  const undescribable: UndescribableMutant[] = []
  plans.forEach((plan) =>
    Result.match(wireRecordOf(plan.mutant), {
      onSuccess: (wireMutant) => {
        wire.push(wireMutant)
      },
      onFailure: (refused) => {
        undescribable.push(refused)
      },
    })
  )
  return { wire, undescribable }
}

const compileErrorAnswersOf = (
  undescribable: readonly UndescribableMutant[],
): Readonly<Record<string, CheckResult>> =>
  Object.fromEntries(
    undescribable.map((mutant): readonly [string, CheckResult] => [
      mutant.id,
      { status: 'compileError', reason: mutant.reason },
    ]),
  )

const singletonGroupsOf = (undescribable: readonly UndescribableMutant[]): readonly (readonly string[])[] =>
  undescribable.map((mutant) => [mutant.id])

const undescribableIdsOf = (undescribable: readonly UndescribableMutant[]): ReadonlySet<string> =>
  new Set(undescribable.map((mutant) => mutant.id))

interface WireLookup {
  readonly wireById: ReadonlyMap<string, CheckerMutantWire>
  readonly undescribableById: ReadonlyMap<string, UndescribableMutant>
}

const lookupOf = (partitioned: PartitionedMutants): WireLookup => ({
  wireById: new Map(partitioned.wire.map((mutant): readonly [string, CheckerMutantWire] => [mutant.id, mutant])),
  undescribableById: new Map(
    partitioned.undescribable.map((mutant): readonly [string, UndescribableMutant] => [mutant.id, mutant]),
  ),
})

const selectedFromLookup = (
  plans: readonly MutantRunPlan[],
  lookup: WireLookup,
): PartitionedMutants => {
  const wire: CheckerMutantWire[] = []
  const undescribable: UndescribableMutant[] = []
  plans.forEach((plan) => {
    Option.match(Option.fromUndefinedOr(lookup.wireById.get(plan.mutant.id)), {
      onSome: (wired) => {
        wire.push(wired)
      },
      onNone: () =>
        Option.match(Option.fromUndefinedOr(lookup.undescribableById.get(plan.mutant.id)), {
          onSome: (refused) => {
            undescribable.push(refused)
          },
          onNone: () => {
            Result.match(wireRecordOf(plan.mutant), {
              onSuccess: (wired) => {
                wire.push(wired)
              },
              onFailure: (refused) => {
                undescribable.push(refused)
              },
            })
          },
        }),
    })
  })
  return { wire, undescribable }
}

const SKIPPED_IDS_IN_WARNING = 5

const skippedIdsOf = (undescribable: readonly UndescribableMutant[]): string =>
  `${undescribable.slice(0, SKIPPED_IDS_IN_WARNING).map((item) => item.id).join(', ')}${
    Option.match(
      Option.liftPredicate(undescribable.length, (count) => count > SKIPPED_IDS_IN_WARNING),
      {
        onNone: () => '',
        onSome: (count) => `, +${count - SKIPPED_IDS_IN_WARNING} more`,
      },
    )
  }`

const refusalReasonsOf = (undescribable: readonly UndescribableMutant[]): string =>
  [...new Set(undescribable.map((mutant) => mutant.reason))].join('; ')

const logSkippedMutants = (
  checkerName: string,
  undescribable: readonly UndescribableMutant[],
): Effect.Effect<void> =>
  Match.value(undescribable.length).pipe(
    Match.when(0, () => Effect.void),
    Match.orElse(() =>
      Effect.logWarning(
        `Checker "${checkerName}" skipped ${undescribable.length} mutant(s) it cannot be told about: ${
          refusalReasonsOf(undescribable)
        } (${skippedIdsOf(undescribable)})`,
      )
    ),
  )

/**
 * Ask a checker about run plans and get run plans back.
 *
 * The port speaks `Mutant` because that is all a checker needs; the engine
 * schedules `MutantRunPlan`. This is the two-line shell around that translation:
 * project the plans down, call the checker, and hand the answers to the pure decision
 * that joins them back. The join is where the work is, and it is pure.
 */
export const checkPlans = (
  checker: CheckerResourceService,
  checkerName: string,
  plans: readonly MutantRunPlan[],
  lookup?: WireLookup,
): Effect.Effect<
  readonly (readonly [MutantRunPlan, CheckResult])[],
  CheckerCrash | CheckerFailed | CheckerContractBroken
> => {
  const description = Cell.layer({
    read: (
      command: {
        readonly checker: CheckerResourceService
        readonly checkerName: string
        readonly plans: readonly MutantRunPlan[]
        readonly lookup?: WireLookup | undefined
      },
    ) =>
      Effect.gen(function*() {
        const partitioned = Option.match(Option.fromUndefinedOr(command.lookup), {
          onSome: (known) => selectedFromLookup(command.plans, known),
          onNone: () => partitionMutantsForWire(command.plans),
        })
        yield* logSkippedMutants(command.checkerName, partitioned.undescribable)
        if (partitioned.undescribable.length > 0) {
          yield* Metric.update(checkerMutantsSkipped, partitioned.undescribable.length)
        }
        yield* Effect.annotateCurrentSpan({
          'stryker.checker.skipped_mutants_count': partitioned.undescribable.length,
        })
        const answers = yield* command.checker.check(command.checkerName, partitioned.wire)
        return {
          checkerName: command.checkerName,
          requestedIds: command.plans.map((plan) => plan.mutant.id),
          answers: { ...compileErrorAnswersOf(partitioned.undescribable), ...answers },
        }
      }),
    decode: (
      raw: {
        readonly checkerName: string
        readonly requestedIds: readonly string[]
        readonly answers: Readonly<Record<string, CheckResult>>
      },
    ): Result.Result<CheckerCommand, CheckerContractBroken> =>
      Result.succeed(
        CheckerCommand.make({
          checkerName: raw.checkerName,
          requestedIds: [...raw.requestedIds],
          phase: 'check',
          answers: { ...raw.answers },
        }),
      ),
    decide: admitCheckerAnswer,
    encode: (outcome) => outcome,
    write: (outcome, raw) => writeCheckerOutcome(plans, raw.checkerName, outcome),
  })
  return description.run({ checker, checkerName, plans, lookup })
}

/**
 * Ask a checker how to group run plans, and get groups of run plans back.
 */
export const groupPlans = (
  checker: CheckerResourceService,
  checkerName: string,
  plans: readonly MutantRunPlan[],
  lookup?: WireLookup,
): Effect.Effect<
  readonly (readonly MutantRunPlan[])[],
  CheckerCrash | CheckerFailed | CheckerContractBroken
> => {
  const description = Cell.layer({
    read: (
      command: {
        readonly checker: CheckerResourceService
        readonly checkerName: string
        readonly plans: readonly MutantRunPlan[]
        readonly lookup?: WireLookup | undefined
      },
    ) =>
      Effect.gen(function*() {
        const partitioned = Option.match(Option.fromUndefinedOr(command.lookup), {
          onSome: (known) => selectedFromLookup(command.plans, known),
          onNone: () => partitionMutantsForWire(command.plans),
        })
        yield* Effect.annotateCurrentSpan({
          'stryker.checker.skipped_mutants_count': partitioned.undescribable.length,
        })
        const undescribableIds = undescribableIdsOf(partitioned.undescribable)
        const checkerGroups = yield* command.checker.group(command.checkerName, partitioned.wire)
        const withoutSkipped = checkerGroups
          .map((group) => group.filter((id) => !undescribableIds.has(id)))
          .filter((group) => group.length > 0)
        return {
          checkerName: command.checkerName,
          requestedIds: command.plans.map((plan) => plan.mutant.id),
          idGroups: [...singletonGroupsOf(partitioned.undescribable), ...withoutSkipped],
        }
      }),
    decode: (
      raw: {
        readonly checkerName: string
        readonly requestedIds: readonly string[]
        readonly idGroups: readonly (readonly string[])[]
      },
    ): Result.Result<CheckerCommand, CheckerContractBroken> =>
      Result.succeed(
        CheckerCommand.make({
          checkerName: raw.checkerName,
          requestedIds: [...raw.requestedIds],
          phase: 'group',
          idGroups: raw.idGroups.map((group) => [...group]),
        }),
      ),
    decide: admitCheckerAnswer,
    encode: (outcome) => outcome,
    write: (outcome, raw) => writeGroupOutcome(plans, raw.checkerName, outcome),
  })
  return description.run({ checker, checkerName, plans, lookup })
}

export const checkGroupedPlans = (
  checker: CheckerResourceService,
  checkerName: string,
  plans: readonly MutantRunPlan[],
): Effect.Effect<
  readonly (readonly [MutantRunPlan, CheckResult])[],
  CheckerCrash | CheckerFailed | CheckerContractBroken
> =>
  Effect.gen(function*() {
    const lookup = lookupOf(partitionMutantsForWire(plans))
    const groups = yield* groupPlans(checker, checkerName, plans, lookup)
    const checked = yield* Effect.forEach(
      groups,
      (group: readonly MutantRunPlan[]) => checkPlans(checker, checkerName, group, lookup),
      { concurrency: 1 },
    )
    return checked.flat()
  })
