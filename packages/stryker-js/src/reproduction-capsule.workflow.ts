import { Workflow } from '@systemfsoftware/effect-cell-types'
import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const CLI_BIN = 'stryker'
const DRY_RUN_FLAG = '--dryRunOnly'
const MUTANT_FLAG = '--mutant'

const ReproductionCapsuleTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/ReproductionCapsule',
)
type ReproductionCapsuleTypeId = typeof ReproductionCapsuleTypeId

export class CapsuleReplays extends S.TaggedClass<CapsuleReplays>()('Replays', {
  cwd: S.NonEmptyString,
  argv: S.NonEmptyArray(S.String),
  env: S.Array(FailureRecord.EnvEntry),
}) {
  readonly [ReproductionCapsuleTypeId] = ReproductionCapsuleTypeId
}

export class CapsuleDoesNotReplay extends S.TaggedClass<CapsuleDoesNotReplay>()('DoesNotReplay', {
  why: FailureRecord.NonReplayReason,
  standIn: S.NonEmptyString,
}) {
  readonly [ReproductionCapsuleTypeId] = ReproductionCapsuleTypeId
}

export type ReproductionCapsuleDecision = CapsuleReplays | CapsuleDoesNotReplay

export class ReproductionCapsuleCommand extends S.TaggedClass<ReproductionCapsuleCommand>()(
  'ReproductionCapsuleCommand',
  {
    evidence: FailureRecord.FailureEvidence,
    argv: S.NonEmptyArray(S.String),
    cwd: S.NonEmptyString,
    envMarker: FailureRecord.EnvEntry,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const replays = (
  argv: readonly [string, ...Array<string>],
  command: ReproductionCapsuleCommand,
): CapsuleReplays => CapsuleReplays.make({ cwd: command.cwd, argv, env: [command.envMarker] })

const doesNotReplay = (
  why: FailureRecord.NonReplayReason,
  standIn: string,
): CapsuleDoesNotReplay => CapsuleDoesNotReplay.make({ why, standIn })

const dryRunArgv = (argv: readonly [string, ...Array<string>]): readonly [string, ...Array<string>] =>
  Boolean.match(Arr.contains(argv, DRY_RUN_FLAG), {
    onTrue: () => argv,
    onFalse: () => Arr.append(argv, DRY_RUN_FLAG),
  })

const crashedStandIn = (
  workerKind: FailureRecord.WorkerKind,
  pid: number,
  exitCode: number | null,
  signal: string | null,
): string =>
  Option.match(Option.fromNullishOr(exitCode), {
    onSome: (code) => `${workerKind} pid ${pid} exited ${code}`,
    onNone: () =>
      Option.match(Option.fromNullishOr(signal), {
        onSome: (name) => `${workerKind} pid ${pid} was killed by ${name}`,
        onNone: () => `${workerKind} pid ${pid} exited without a code`,
      }),
  })

const missingStandIn = (exitCode: number | null): string =>
  Option.match(Option.fromNullishOr(exitCode), {
    onSome: (code) => `the job wrote neither a failure record nor a report (exit code ${code})`,
    onNone: () => 'the job wrote neither a failure record nor a report',
  })

const ownReplays = (command: ReproductionCapsuleCommand): CapsuleReplays => replays(command.argv, command)

const capsuleFor = (command: ReproductionCapsuleCommand): ReproductionCapsuleDecision =>
  Match.value(command.evidence).pipe(
    Match.tagsExhaustive({
      WorkerOutOfMemory: ({ workerKind, pid, exitCode }) =>
        doesNotReplay('outOfMemory', `${workerKind} pid ${pid} exited ${exitCode}`),
      WorkerCrashed: ({ workerKind, pid, exitCode, signal }) =>
        doesNotReplay('workerCrashed', crashedStandIn(workerKind, pid, exitCode, signal)),
      RunInterrupted: () => doesNotReplay('interrupted', 'the run was interrupted; re-run it with the same command'),
      RecordMissing: ({ exitCode }) => doesNotReplay('recordMissing', missingStandIn(exitCode)),
      JobTimedOut: ({ limitSeconds }) =>
        doesNotReplay('jobTimedOut', `the job exceeded its ${limitSeconds}s time limit`),
      BinaryMissing: ({ binary }) => doesNotReplay('binaryMissing', `the required binary "${binary}" was not found`),
      BaselineTestsFailed: ({ tests }) =>
        Option.match(Option.fromNullishOr(Arr.headNonEmpty(tests).reproduce), {
          onSome: (reproduce) => replays(reproduce, command),
          onNone: () => replays(dryRunArgv(command.argv), command),
        }),
      NewSurvivors: ({ survivors }) =>
        replays([CLI_BIN, 'run', MUTANT_FLAG, Arr.join(Arr.map(survivors, (each) => each.mutantId), ',')], command),
      BaselineTimedOut: () => replays(dryRunArgv(command.argv), command),
      BaselineErrored: () => replays(dryRunArgv(command.argv), command),
      BaselineFoundNoTests: () => replays(dryRunArgv(command.argv), command),
      ArgumentsInvalid: () => ownReplays(command),
      ConfigInvalid: () => ownReplays(command),
      PluginNotFound: () => ownReplays(command),
      PluginLoadFailed: () => ownReplays(command),
      PluginImportFailed: () => ownReplays(command),
      SurvivorsUnavailable: () => ownReplays(command),
      NoInputFiles: () => ownReplays(command),
      SandboxPreparationFailed: () => ownReplays(command),
      InstrumentationFailed: () => ownReplays(command),
      CheckerFailed: () => ownReplays(command),
      TestRunnerFailed: () => ownReplays(command),
      WorkerBootTimedOut: () => ownReplays(command),
      ReporterFailed: () => ownReplays(command),
      InvariantBroken: () => ownReplays(command),
      CatalogGap: () => ownReplays(command),
    }),
  )

const decide = (command: ReproductionCapsuleCommand): Result.Result<ReproductionCapsuleDecision, never> =>
  Result.succeed(capsuleFor(command))

export const reproductionCapsule = Workflow.make({
  command: ReproductionCapsuleCommand,
  decision: S.Union([CapsuleReplays, CapsuleDoesNotReplay]),
  error: S.Never,
  decide,
})
