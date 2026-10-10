import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  PreviousReuseRecordSchema,
  type ReuseRefusalReason,
  ReuseRefusalReasonSchema,
  TimeoutEvidenceSchema,
  TimeoutKindSchema,
} from './IncrementalDiff.schema.js'
import type { PreviousReuseRecord, TimeoutEvidence } from './IncrementalDiff.schema.js'

const isReusableStatus = S.is(Mutant.RememberedStatusSchema)

const NO_PREVIOUS_RECORDS: readonly PreviousReuseRecord[] = []

const IncrementalDiffTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/IncrementalDiff')
type IncrementalDiffTypeId = typeof IncrementalDiffTypeId

export class IncrementalDiffCommand extends S.TaggedClass<IncrementalDiffCommand>()('IncrementalDiffCommand', {
  currentMutants: S.Array(Mutant.Mutant),
  previousRecords: S.Array(PreviousReuseRecordSchema),
  closureDigestsByMutantId: S.Record(Mutant.MutantId, S.String),
  closureAnalysisFailed: S.Boolean,
  engineDigest: S.String,
  mutantSetPolicy: Options.MutantSetPolicy,
  runInputsDigest: S.String,
  force: S.Boolean,
  flakyMutantIds: S.String.pipe(S.Array, S.optional),
  programDigest: S.optional(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    force: 'stryker.incremental_diff.force',
  } as const
}

const rememberedFields = {
  mutantId: Mutant.MutantId,
  timeoutKind: S.optional(TimeoutKindSchema),
  reproductions: S.optional(S.Natural),
  testsCompleted: S.optional(S.Finite),
  coveredBy: S.String.pipe(S.Array, S.optional),
  killedBy: S.String.pipe(S.Array, S.optional),
}

export class MutantRememberedIgnored extends S.TaggedClass<MutantRememberedIgnored>()('MutantRemembered', {
  ...rememberedFields,
  status: S.Literal('Ignored'),
  statusReason: Mutant.IgnoreStatusReasonText,
}) {
  readonly [IncrementalDiffTypeId] = IncrementalDiffTypeId
}

export class MutantRememberedSettled extends S.TaggedClass<MutantRememberedSettled>()('MutantRemembered', {
  ...rememberedFields,
  status: Mutant.SettledStatusSchema,
  statusReason: S.optional(S.String),
}) {
  readonly [IncrementalDiffTypeId] = IncrementalDiffTypeId
}

export const MutantRemembered = S.Union([MutantRememberedIgnored, MutantRememberedSettled])
export type MutantRemembered = typeof MutantRemembered.Type

export class MutantToRun extends S.TaggedClass<MutantToRun>()('MutantToRun', {
  mutant: Mutant.Mutant,
  refusal: ReuseRefusalReasonSchema,
  priorTimeout: S.optional(TimeoutEvidenceSchema),
}) {
  readonly [IncrementalDiffTypeId] = IncrementalDiffTypeId
}

export type IncrementalDiffDecision = MutantRemembered | MutantToRun

type CacheKeyComponents = {
  readonly engineDigest: string
  readonly mutantSetPolicy: Options.MutantSetPolicy
  readonly runInputsDigest: string
}

const isUnreproducedWallClockTimeout = (record: PreviousReuseRecord): boolean =>
  Boolean.and(
    record.status === 'Timeout',
    Boolean.and(
      Boolean.not(record.timeoutKind === 'hitLimit'),
      Option.getOrElse(Option.fromUndefinedOr(record.reproductions), () => 0) < 1,
    ),
  )

const carriesSubsumptionReference = (record: PreviousReuseRecord): boolean => record.subsumption !== undefined

const isReusableRecord = (record: PreviousReuseRecord): boolean =>
  Boolean.and(
    Boolean.and(isReusableStatus(record.status), Boolean.not(isUnreproducedWallClockTimeout(record))),
    Boolean.not(carriesSubsumptionReference(record)),
  )

const timeoutEvidenceOf = (record: PreviousReuseRecord): Option.Option<TimeoutEvidence> =>
  Option.map(
    Option.fromUndefinedOr(record.timeoutKind),
    (timeoutKind) => ({
      timeoutKind,
      reproductions: Option.getOrElse(Option.fromUndefinedOr(record.reproductions), () => 0),
    }),
  )

const digestOf = (digest: string | undefined): string => Option.getOrElse(Option.fromUndefinedOr(digest), () => '')

const isCompileErrorRecord = (record: PreviousReuseRecord): boolean => record.status === 'CompileError'

const keyOf = (mutantId: string, digest: string | undefined, components: CacheKeyComponents): string =>
  [
    mutantId,
    digestOf(digest),
    components.engineDigest,
    components.mutantSetPolicy,
    components.runInputsDigest,
  ].join('\u0000')

const currentKeyOf = (command: IncrementalDiffCommand, mutantId: Mutant.MutantId): string =>
  keyOf(mutantId, command.closureDigestsByMutantId[mutantId], command)

const matchingProgramKey = (command: IncrementalDiffCommand, record: PreviousReuseRecord): boolean =>
  Boolean.and(
    digestOf(record.programDigest) !== '',
    keyOf(record.mutantId, record.programDigest, record) === keyOf(record.mutantId, command.programDigest, command),
  )

const matchingKey = (command: IncrementalDiffCommand, record: PreviousReuseRecord): boolean =>
  Boolean.and(
    Boolean.not(command.closureAnalysisFailed),
    Boolean.match(isCompileErrorRecord(record), {
      onTrue: () => matchingProgramKey(command, record),
      onFalse: () => keyOf(record.mutantId, record.closureDigest, record) === currentKeyOf(command, record.mutantId),
    }),
  )

const closureDigestChanged = (command: IncrementalDiffCommand, record: PreviousReuseRecord): boolean =>
  Boolean.and(
    Boolean.not(isCompileErrorRecord(record)),
    digestOf(record.closureDigest) !== digestOf(command.closureDigestsByMutantId[record.mutantId]),
  )

const programChanged = (command: IncrementalDiffCommand, record: PreviousReuseRecord): boolean =>
  Boolean.and(isCompileErrorRecord(record), Boolean.not(matchingProgramKey(command, record)))

const reasonAfterClosure = (command: IncrementalDiffCommand, record: PreviousReuseRecord): ReuseRefusalReason =>
  Boolean.match(command.closureAnalysisFailed, {
    onTrue: (): ReuseRefusalReason => 'closureAnalysisFailed',
    onFalse: () =>
      Boolean.match(closureDigestChanged(command, record), {
        onTrue: (): ReuseRefusalReason => 'closureChanged',
        onFalse: (): ReuseRefusalReason =>
          Boolean.match(isUnreproducedWallClockTimeout(record), {
            onTrue: () => 'timeoutUnreproduced',
            onFalse: () => 'noPriorRecord',
          }),
      }),
  })

const reasonAfterRunInputs = (command: IncrementalDiffCommand, record: PreviousReuseRecord): ReuseRefusalReason =>
  Boolean.match(record.runInputsDigest !== command.runInputsDigest, {
    onTrue: (): ReuseRefusalReason => 'runInputsChanged',
    onFalse: () =>
      Boolean.match(programChanged(command, record), {
        onTrue: (): ReuseRefusalReason => 'programChanged',
        onFalse: () => reasonAfterClosure(command, record),
      }),
  })

const reasonAfterPolicy = (command: IncrementalDiffCommand, record: PreviousReuseRecord): ReuseRefusalReason =>
  Boolean.match(record.mutantSetPolicy !== command.mutantSetPolicy, {
    onTrue: (): ReuseRefusalReason => 'policyChanged',
    onFalse: () => reasonAfterRunInputs(command, record),
  })

const refusalOf = (command: IncrementalDiffCommand, record: PreviousReuseRecord): ReuseRefusalReason =>
  Boolean.match(record.engineDigest !== command.engineDigest, {
    onTrue: (): ReuseRefusalReason => 'semanticsChanged',
    onFalse: () => reasonAfterPolicy(command, record),
  })

const newestMatchingOf = (
  records: readonly PreviousReuseRecord[],
  command: IncrementalDiffCommand,
): Option.Option<PreviousReuseRecord> =>
  Arr.reduce(
    records,
    Option.none<PreviousReuseRecord>(),
    (found, record) =>
      Option.match(Option.liftPredicate(record, isReusableRecord), {
        onNone: () => found,
        onSome: (reusable) =>
          Boolean.match(matchingKey(command, reusable), {
            onTrue: () => Option.some(reusable),
            onFalse: () => found,
          }),
      }),
  )

const rememberedOptionalFieldsOf = (record: PreviousReuseRecord) => ({
  ...Option.match(Option.fromUndefinedOr(record.timeoutKind), {
    onNone: () => ({}),
    onSome: (timeoutKind) => ({ timeoutKind }),
  }),
  ...Option.match(Option.fromUndefinedOr(record.reproductions), {
    onNone: () => ({}),
    onSome: (reproductions) => ({ reproductions }),
  }),
  ...Option.match(Option.fromUndefinedOr(record.testsCompleted), {
    onNone: () => ({}),
    onSome: (testsCompleted) => ({ testsCompleted }),
  }),
  ...Option.match(Option.fromUndefinedOr(record.coveredBy), {
    onNone: () => ({}),
    onSome: (coveredBy) => ({ coveredBy: [...coveredBy] }),
  }),
  ...Option.match(Option.fromUndefinedOr(record.killedBy), {
    onNone: () => ({}),
    onSome: (killedBy) => ({ killedBy: [...killedBy] }),
  }),
})

type IgnoredRecord = Extract<PreviousReuseRecord, { readonly status: 'Ignored' }>
type SettledRecord = Exclude<PreviousReuseRecord, IgnoredRecord>

const rememberedIgnoredOf = (mutant: Mutant.Mutant) => (record: IgnoredRecord): MutantRemembered =>
  MutantRememberedIgnored.make({
    mutantId: mutant.id,
    status: 'Ignored',
    statusReason: record.statusReason,
    ...rememberedOptionalFieldsOf(record),
  })

const rememberedSettledOf = (mutant: Mutant.Mutant) => (record: SettledRecord): MutantRemembered =>
  MutantRememberedSettled.make({
    mutantId: mutant.id,
    status: record.status,
    statusReason: record.statusReason,
    ...rememberedOptionalFieldsOf(record),
  })

const rememberedOf = (mutant: Mutant.Mutant, record: PreviousReuseRecord): MutantRemembered => {
  const settled = rememberedSettledOf(mutant)
  return Match.value(record).pipe(
    Match.discriminatorsExhaustive('status')({
      Ignored: rememberedIgnoredOf(mutant),
      Killed: settled,
      Survived: settled,
      NoCoverage: settled,
      CompileError: settled,
      RuntimeError: settled,
      Timeout: settled,
      Pending: settled,
    }),
  )
}

const refusalForMutant = (
  command: IncrementalDiffCommand,
  records: readonly PreviousReuseRecord[],
): ReuseRefusalReason =>
  Option.match(Arr.last(records), {
    onNone: (): ReuseRefusalReason => 'noPriorRecord',
    onSome: (newest) => refusalOf(command, newest),
  })

const priorTimeoutField = (
  refusal: ReuseRefusalReason,
  records: readonly PreviousReuseRecord[],
) =>
  Boolean.match(refusal === 'timeoutUnreproduced', {
    onTrue: () =>
      Option.match(Arr.last(records), {
        onNone: (): Readonly<Record<string, never>> => ({}),
        onSome: (newest) =>
          Option.match(timeoutEvidenceOf(newest), {
            onNone: (): Readonly<Record<string, never>> => ({}),
            onSome: (priorTimeout) => ({ priorTimeout }),
          }),
      }),
    onFalse: (): Readonly<Record<string, never>> => ({}),
  })

const flakyMutantIdsOf = (command: IncrementalDiffCommand): readonly string[] =>
  Option.getOrElse(Option.fromUndefinedOr(command.flakyMutantIds), (): readonly string[] => [])

/**
 * A mutant is flaky-dependent when a flaky test covers it — or when it is static and any test is
 * flaky, because a static mutant runs every test in the suite and so inherits every flaky test's
 * instability even though it never appears in the per-test coverage.
 */
const flakyDependent = (command: IncrementalDiffCommand, mutant: Mutant.Mutant): boolean => {
  const flaky = flakyMutantIdsOf(command)
  return Boolean.or(flaky.includes(mutant.id), Boolean.and(mutant.static === true, flaky.length > 0))
}

const flakyRefusedOf = (
  mutant: Mutant.Mutant,
  records: readonly PreviousReuseRecord[],
): IncrementalDiffDecision =>
  MutantToRun.make({
    mutant,
    refusal: 'flakyDependency',
    ...priorTimeoutField('flakyDependency', records),
  })

const decidedPerRun = (mutant: Mutant.Mutant, records: readonly PreviousReuseRecord[]): boolean =>
  Boolean.or(
    mutant.subsumption !== undefined,
    Option.exists(Arr.last(records), carriesSubsumptionReference),
  )

const toRunOf = (
  mutant: Mutant.Mutant,
  command: IncrementalDiffCommand,
  records: readonly PreviousReuseRecord[],
): IncrementalDiffDecision => {
  const reason = refusalForMutant(command, records)
  const refusal: ReuseRefusalReason = Boolean.match(
    Boolean.and(reason === 'noPriorRecord', decidedPerRun(mutant, records)),
    { onTrue: () => 'decidedPerRun', onFalse: () => reason },
  )
  return MutantToRun.make({ mutant, refusal, ...priorTimeoutField(refusal, records) })
}

const rememberableOf = (
  mutant: Mutant.Mutant,
  command: IncrementalDiffCommand,
  records: readonly PreviousReuseRecord[],
): Option.Option<PreviousReuseRecord> =>
  Option.filter(newestMatchingOf(records, command), () => mutant.subsumption === undefined)

const decideForMutant = (
  mutant: Mutant.Mutant,
  command: IncrementalDiffCommand,
  recordsById: Record.ReadonlyRecord<Mutant.MutantId, readonly PreviousReuseRecord[]>,
): IncrementalDiffDecision => {
  const records = Option.getOrElse(Record.get(recordsById, mutant.id), () => NO_PREVIOUS_RECORDS)
  return Boolean.match(flakyDependent(command, mutant), {
    onTrue: () => flakyRefusedOf(mutant, records),
    onFalse: () =>
      Option.match(rememberableOf(mutant, command, records), {
        onNone: () => toRunOf(mutant, command, records),
        onSome: (record) => rememberedOf(mutant, record),
      }),
  })
}

const recordsByIdOf = (
  records: readonly PreviousReuseRecord[],
): Record.ReadonlyRecord<Mutant.MutantId, readonly PreviousReuseRecord[]> =>
  Arr.groupBy(records, (record) => record.mutantId)

const forcedRun = (mutant: Mutant.Mutant) => MutantToRun.make({ mutant, refusal: 'noPriorRecord' })

const decideChanged = (command: IncrementalDiffCommand): readonly IncrementalDiffDecision[] => {
  const recordsById = recordsByIdOf(command.previousRecords)
  return command.currentMutants.map((mutant) => decideForMutant(mutant, command, recordsById))
}

const decide = (command: IncrementalDiffCommand): Result.Result<readonly IncrementalDiffDecision[], never> =>
  Boolean.match(command.force, {
    onTrue: () => Result.succeed(command.currentMutants.map(forcedRun)),
    onFalse: () => Result.succeed(decideChanged(command)),
  })

export const incrementalDiff = Workflow.make({
  command: IncrementalDiffCommand,
  decision: S.Array(S.Union([MutantRemembered, MutantToRun])),
  error: S.Never,
  decide,
})
