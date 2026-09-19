/**
 * Checker — the Checker capability.
 *
 * Owns the checker port, its contract, the child-process edge, and the
 * Cell pipelines that drive a checker through a pure workflow. A checker
 * speaks `Mutant`; the engine schedules `MutantRunPlan` — this module bridges
 * the two and verifies the join.
 */

import { Cell } from '@systemfsoftware/effect-cell-types'
import type { FileDescriptions, RunPlan as MutantRunPlan } from '@systemfsoftware/stryker-js-instrumenter/mutants'
import {
  CheckerMutantWire,
  CheckerRpcs,
  type CheckResult,
  type StrykerOptions,
} from '@systemfsoftware/stryker-js-plugin-interface'

import { encodeWorkerOptions } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Match from 'effect/Match'
import * as Metric from 'effect/Metric'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
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
import { checkerCrashes, checkerDuration, checkerMutantsChecked, checkerMutantsSkipped } from './metrics.js'
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
  ) => Effect.Effect<Record<string, CheckResult>, CheckerCrash>
  readonly group: (
    checkerName: string,
    mutants: readonly CheckerMutantWire[],
  ) => Effect.Effect<readonly (readonly string[])[], CheckerCrash>
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
    )

    return {
      check: (checkerName: string, mutants: readonly CheckerMutantWire[]) =>
        Effect.gen(function*() {
          const start = yield* Clock.currentTimeMillis
          return yield* client.check({ checkerName, mutants: [...mutants] }).pipe(
            Effect.withSpan('stryker.checker.check', {
              attributes: {
                'stryker.checker.name': checkerName,
                'stryker.mutants.count': mutants.length,
              },
            }),
            Effect.onExit((exit) =>
              Effect.gen(function*() {
                const end = yield* Clock.currentTimeMillis
                yield* Metric.update(checkerDuration, Duration.millis(end - start))
                if (Exit.isSuccess(exit)) {
                  yield* Metric.update(checkerMutantsChecked, mutants.length)
                } else {
                  yield* Metric.update(checkerCrashes, 1)
                }
              })
            ),
            Effect.mapError((error) => crashed(error.message)),
          )
        }),
      group: (checkerName: string, mutants: readonly CheckerMutantWire[]) =>
        client.group({ checkerName, mutants: [...mutants] }).pipe(
          Effect.withSpan('stryker.checker.group', {
            attributes: {
              'stryker.checker.name': checkerName,
              'stryker.mutants.count': mutants.length,
            },
          }),
          Effect.mapError((error) => crashed(error.message)),
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
interface PartitionedPlansForWire {
  readonly wireMutants: readonly CheckerMutantWire[]
  readonly skipped: readonly { readonly id: string; readonly fileName: string }[]
  readonly skippedAnswers: Readonly<Record<string, CheckResult>>
  readonly skippedGroups: readonly (readonly string[])[]
}

const partitionPlansForWire = (plans: readonly MutantRunPlan[]): PartitionedPlansForWire =>
  plans.reduce<PartitionedPlansForWire>(
    (acc, plan) => {
      const decodeResult = S.decodeUnknownResult(CheckerMutantWire)(plan.mutant)
      return Result.match(decodeResult, {
        onSuccess: (wireMutant) => ({
          ...acc,
          wireMutants: [...acc.wireMutants, wireMutant],
        }),
        onFailure: () => ({
          ...acc,
          skipped: [...acc.skipped, { id: plan.mutant.id, fileName: plan.mutant.fileName }],
          skippedAnswers: {
            ...acc.skippedAnswers,
            [plan.mutant.id]: { status: 'compileError', reason: 'Invalid wire mutant description' },
          },
          skippedGroups: [...acc.skippedGroups, [plan.mutant.id]],
        }),
      })
    },
    { wireMutants: [], skipped: [], skippedAnswers: {}, skippedGroups: [] },
  )

const logSkippedMutants = (
  checkerName: string,
  skipped: readonly { readonly id: string; readonly fileName: string }[],
): Effect.Effect<void> =>
  Effect.forEach(
    skipped,
    (item) =>
      Effect.logWarning(
        `Checker "${checkerName}" skipped mutant ${item.id} in ${item.fileName}: location or metadata cannot be described to checker`,
      ),
    { discard: true },
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
): Effect.Effect<
  readonly (readonly [MutantRunPlan, CheckResult])[],
  CheckerCrash | CheckerContractBroken
> => {
  const description = Cell.layer({
    read: (
      command: {
        readonly checker: CheckerResourceService
        readonly checkerName: string
        readonly plans: readonly MutantRunPlan[]
      },
    ) =>
      Effect.gen(function*() {
        const partitioned = partitionPlansForWire(command.plans)
        yield* logSkippedMutants(command.checkerName, partitioned.skipped)
        if (partitioned.skipped.length > 0) {
          yield* Metric.update(checkerMutantsSkipped, partitioned.skipped.length)
        }
        yield* Effect.annotateCurrentSpan({
          'stryker.checker.skipped_mutants_count': partitioned.skipped.length,
        })
        const answers = yield* command.checker.check(command.checkerName, partitioned.wireMutants)
        return {
          checkerName: command.checkerName,
          requestedIds: command.plans.map((plan) => plan.mutant.id),
          answers: { ...partitioned.skippedAnswers, ...answers },
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
  return description.run({ checker, checkerName, plans })
}

/**
 * Ask a checker how to group run plans, and get groups of run plans back.
 */
export const groupPlans = (
  checker: CheckerResourceService,
  checkerName: string,
  plans: readonly MutantRunPlan[],
): Effect.Effect<
  readonly (readonly MutantRunPlan[])[],
  CheckerCrash | CheckerContractBroken
> => {
  const description = Cell.layer({
    read: (
      command: {
        readonly checker: CheckerResourceService
        readonly checkerName: string
        readonly plans: readonly MutantRunPlan[]
      },
    ) =>
      Effect.gen(function*() {
        const partitioned = partitionPlansForWire(command.plans)
        yield* logSkippedMutants(command.checkerName, partitioned.skipped)
        yield* Effect.annotateCurrentSpan({
          'stryker.checker.skipped_mutants_count': partitioned.skipped.length,
        })
        const idGroups = yield* command.checker.group(command.checkerName, partitioned.wireMutants)
        return {
          checkerName: command.checkerName,
          requestedIds: command.plans.map((plan) => plan.mutant.id),
          idGroups: [...partitioned.skippedGroups, ...idGroups],
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
  return description.run({ checker, checkerName, plans })
}

export const checkGroupedPlans = (
  checker: CheckerResourceService,
  checkerName: string,
  plans: readonly MutantRunPlan[],
): Effect.Effect<
  readonly (readonly [MutantRunPlan, CheckResult])[],
  CheckerCrash | CheckerContractBroken
> =>
  Effect.gen(function*() {
    const groups = yield* groupPlans(checker, checkerName, plans)
    const checked = yield* Effect.forEach(
      groups,
      (group: readonly MutantRunPlan[]) => checkPlans(checker, checkerName, group),
      { concurrency: 1 },
    )
    return checked.flat()
  })
