import * as S from 'effect/Schema'

export const FailureStage = S.Literals([
  'cli',
  'config',
  'prepare',
  'instrument',
  'check',
  'dryRun',
  'mutationTest',
  'report',
  'gate',
  'ci',
  'run',
])
export type FailureStage = typeof FailureStage.Type

export const NextActionKind = S.Literals([
  'fixTest',
  'fixCode',
  'killSurvivor',
  'refactorAwayEquivalent',
  'fixConfiguration',
  'retryInfrastructure',
  'reportToolDefect',
])
export type NextActionKind = typeof NextActionKind.Type

export const NextAction = S.Struct({ primary: NextActionKind, otherwise: S.NullOr(NextActionKind) })
export type NextAction = typeof NextAction.Type

export const CauseLink = S.Struct({ kind: S.String, message: S.String, stack: S.NullOr(S.String) })
export type CauseLink = typeof CauseLink.Type

export const EnvEntry = S.Struct({ name: S.NonEmptyString, value: S.String })
export type EnvEntry = typeof EnvEntry.Type

export const NonReplayReason = S.Literals([
  'outOfMemory',
  'workerCrashed',
  'interrupted',
  'recordMissing',
  'jobTimedOut',
  'binaryMissing',
])
export type NonReplayReason = typeof NonReplayReason.Type

export const Replays = S.TaggedStruct('Replays', {
  cwd: S.NonEmptyString,
  argv: S.NonEmptyArray(S.String),
  env: S.Array(EnvEntry),
})
export type Replays = typeof Replays.Type

export const DoesNotReplay = S.TaggedStruct('DoesNotReplay', { why: NonReplayReason, standIn: S.NonEmptyString })
export type DoesNotReplay = typeof DoesNotReplay.Type

export const Capsule = S.Union([Replays, DoesNotReplay])
export type Capsule = typeof Capsule.Type

export const TraceId = S.String.check(S.isPattern(/^[0-9a-f]{32}$/u))
export type TraceId = typeof TraceId.Type

const SourceLine = S.Int.check(S.isGreaterThanOrEqualTo(1))

export const SourceLocation = S.Struct({ file: S.NonEmptyString, line: SourceLine, column: SourceLine })
export type SourceLocation = typeof SourceLocation.Type

export const FailedTestEvidence = S.Struct({
  id: S.String,
  name: S.String,
  file: S.NullOr(S.String),
  location: S.NullOr(SourceLocation),
  message: S.String,
  stack: S.NullOr(S.String),
  reproduce: S.String.pipe(S.NonEmptyArray, S.NullOr),
})
export type FailedTestEvidence = typeof FailedTestEvidence.Type

export const WorkerKind = S.Literals(['testRunner', 'checker', 'reporter'])
export type WorkerKind = typeof WorkerKind.Type

export const PluginLoadRefusal = S.Union([
  S.TaggedStruct('PeerMissing', { peer: S.String }),
  S.TaggedStruct('PeerVersionUnsupported', { peer: S.String, detail: S.String }),
  S.TaggedStruct('PeerUnrecognized', { peer: S.String }),
  S.TaggedStruct('InvalidContribution', { detail: S.String }),
])
export type PluginLoadRefusal = typeof PluginLoadRefusal.Type

const NonNegativeInt = S.Int.check(S.isGreaterThanOrEqualTo(0))

const RecordShared = {
  stage: FailureStage,
  cause: S.Array(CauseLink),
  capsule: Capsule,
  nextAction: NextAction,
  traceId: S.NullOr(TraceId),
}

const variant = <const Tag extends string, const Fields extends S.Struct.Fields>(tag: Tag, fields: Fields) => ({
  tag,
  evidence: S.TaggedStruct(tag, { stage: FailureStage, ...fields }),
  record: S.TaggedStruct(tag, { ...RecordShared, ...fields }),
})

const SurvivorEvidence = S.Struct({ mutantId: S.NonEmptyString, file: S.String, line: SourceLine })

const VARIANTS = [
  variant('ArgumentsInvalid', { argument: S.NullOr(S.String) }),
  variant('ConfigInvalid', { detail: S.String }),
  variant('PluginNotFound', { descriptor: S.String }),
  variant('PluginLoadFailed', { descriptor: S.String, reason: PluginLoadRefusal }),
  variant('PluginImportFailed', { descriptor: S.String }),
  variant('SurvivorsUnavailable', { reason: S.Literals(['no-report', 'mismatch']) }),
  variant('NoInputFiles', {}),
  variant('SandboxPreparationFailed', {}),
  variant('InstrumentationFailed', {}),
  variant('CheckerFailed', { checker: S.NullOr(S.String) }),
  variant('TestRunnerFailed', {}),
  variant('BaselineTestsFailed', { testCount: NonNegativeInt, tests: S.NonEmptyArray(FailedTestEvidence) }),
  variant('BaselineTimedOut', {}),
  variant('BaselineErrored', {}),
  variant('BaselineFoundNoTests', {}),
  variant('WorkerBootTimedOut', { workerKind: WorkerKind, pid: S.Int }),
  variant('WorkerOutOfMemory', { workerKind: WorkerKind, pid: S.Int, exitCode: S.Int }),
  variant('WorkerCrashed', {
    workerKind: WorkerKind,
    pid: S.Int,
    exitCode: S.NullOr(S.Int),
    signal: S.NullOr(S.String),
  }),
  variant('ReporterFailed', { reporter: S.NullOr(S.String) }),
  variant('RunInterrupted', {}),
  variant('NewSurvivors', { survivors: S.NonEmptyArray(SurvivorEvidence), unchecked: NonNegativeInt }),
  variant('InvariantBroken', {}),
  variant('CatalogGap', {}),
  variant('RecordMissing', { exitCode: S.NullOr(S.Int) }),
  variant('JobTimedOut', { limitSeconds: NonNegativeInt }),
  variant('BinaryMissing', { binary: S.String }),
] as const

export const FailureEvidence = S.Union(VARIANTS.map((each) => each.evidence))
export type FailureEvidence = typeof FailureEvidence.Type

export const FailureRecord = S.Union(VARIANTS.map((each) => each.record))
export type FailureRecord = typeof FailureRecord.Type

export const FailureCode = S.Literals(VARIANTS.map((each) => each.tag))
export type FailureCode = typeof FailureCode.Type

export const FailureRecordFile = S.fromJsonString(FailureRecord)
