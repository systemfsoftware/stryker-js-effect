import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
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
  verdictSemanticsVersion: S.Int,
  mutantSetPolicy: Options.MutantSetPolicy,
  runInputsDigest: S.String,
  force: S.Boolean,
  flakyMutantIds: S.String.pipe(S.Array, S.optional),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    force: 'stryker.incremental_diff.force',
  } as const
}

export class MutantRemembered extends S.TaggedClass<MutantRemembered>()('MutantRemembered', {
  mutantId: Mutant.MutantId,
  status: Mutant.RememberedStatusSchema,
  timeoutKind: S.optional(TimeoutKindSchema),
  reproductions: S.optional(S.Natural),
  testsCompleted: S.optional(S.Finite),
  coveredBy: S.String.pipe(S.Array, S.optional),
  killedBy: S.String.pipe(S.Array, S.optional),
}) {
  readonly [IncrementalDiffTypeId] = IncrementalDiffTypeId
}

export class MutantToRun extends S.TaggedClass<MutantToRun>()('MutantToRun', {
  mutant: Mutant.Mutant,
  refusal: ReuseRefusalReasonSchema,
  priorTimeout: S.optional(TimeoutEvidenceSchema),
}) {
  readonly [IncrementalDiffTypeId] = IncrementalDiffTypeId
}

export type IncrementalDiffDecision = MutantRemembered | MutantToRun

type CacheKeyComponents = {
  readonly verdictSemanticsVersion: number
  readonly mutantSetPolicy: Options.MutantSetPolicy
  readonly runInputsDigest: string
}

type RememberedReuseRecord = PreviousReuseRecord & { readonly status: Mutant.RememberedStatus }

const isUnreproducedWallClockTimeout = (record: PreviousReuseRecord): boolean =>
  Boolean.and(
    record.status === 'Timeout',
    Boolean.and(
      Boolean.not(record.timeoutKind === 'hitLimit'),
      Option.getOrElse(Option.fromUndefinedOr(record.reproductions), () => 0) < 1,
    ),
  )

const isReusableRecord = (record: PreviousReuseRecord): record is RememberedReuseRecord =>
  Boolean.and(isReusableStatus(record.status), Boolean.not(isUnreproducedWallClockTimeout(record)))

const timeoutEvidenceOf = (record: PreviousReuseRecord): Option.Option<TimeoutEvidence> =>
  Option.map(
    Option.fromUndefinedOr(record.timeoutKind),
    (timeoutKind) => ({
      timeoutKind,
      reproductions: Option.getOrElse(Option.fromUndefinedOr(record.reproductions), () => 0),
    }),
  )

const digestOf = (digest: string | undefined): string => Option.getOrElse(Option.fromUndefinedOr(digest), () => '')

const cacheKeyOf = (mutantId: string, closureDigest: string | undefined, components: CacheKeyComponents): string =>
  [
    mutantId,
    digestOf(closureDigest),
    String(components.verdictSemanticsVersion),
    components.mutantSetPolicy,
    components.runInputsDigest,
  ].join('\u0000')

const currentKeyOf = (command: IncrementalDiffCommand, mutantId: Mutant.MutantId): string =>
  cacheKeyOf(mutantId, command.closureDigestsByMutantId[mutantId], command)

const matchingKey = (command: IncrementalDiffCommand, record: RememberedReuseRecord): boolean =>
  Boolean.and(
    Boolean.not(command.closureAnalysisFailed),
    cacheKeyOf(record.mutantId, record.closureDigest, record) === currentKeyOf(command, record.mutantId),
  )

const closureChanged = (command: IncrementalDiffCommand, record: PreviousReuseRecord): boolean =>
  Boolean.or(
    command.closureAnalysisFailed,
    digestOf(record.closureDigest) !== digestOf(command.closureDigestsByMutantId[record.mutantId]),
  )

const reasonAfterClosure = (command: IncrementalDiffCommand, record: PreviousReuseRecord): ReuseRefusalReason =>
  Boolean.match(closureChanged(command, record), {
    onTrue: (): ReuseRefusalReason => 'closureChanged',
    onFalse: (): ReuseRefusalReason =>
      Boolean.match(isUnreproducedWallClockTimeout(record), {
        onTrue: () => 'timeoutUnreproduced',
        onFalse: () => 'noPriorRecord',
      }),
  })

const reasonAfterRunInputs = (command: IncrementalDiffCommand, record: PreviousReuseRecord): ReuseRefusalReason =>
  Boolean.match(record.runInputsDigest !== command.runInputsDigest, {
    onTrue: (): ReuseRefusalReason => 'runInputsChanged',
    onFalse: () => reasonAfterClosure(command, record),
  })

const reasonAfterPolicy = (command: IncrementalDiffCommand, record: PreviousReuseRecord): ReuseRefusalReason =>
  Boolean.match(record.mutantSetPolicy !== command.mutantSetPolicy, {
    onTrue: (): ReuseRefusalReason => 'policyChanged',
    onFalse: () => reasonAfterRunInputs(command, record),
  })

const refusalOf = (command: IncrementalDiffCommand, record: PreviousReuseRecord): ReuseRefusalReason =>
  Boolean.match(record.verdictSemanticsVersion !== command.verdictSemanticsVersion, {
    onTrue: (): ReuseRefusalReason => 'semanticsChanged',
    onFalse: () => reasonAfterPolicy(command, record),
  })

const newestMatchingOf = (
  records: readonly PreviousReuseRecord[],
  command: IncrementalDiffCommand,
): Option.Option<RememberedReuseRecord> =>
  Arr.reduce(
    records,
    Option.none<RememberedReuseRecord>(),
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

const rememberedOf = (mutant: Mutant.Mutant, record: RememberedReuseRecord) =>
  MutantRemembered.make({
    mutantId: mutant.id,
    status: record.status,
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

const toRunOf = (
  mutant: Mutant.Mutant,
  command: IncrementalDiffCommand,
  records: readonly PreviousReuseRecord[],
): IncrementalDiffDecision => {
  const refusal = refusalForMutant(command, records)
  return MutantToRun.make({ mutant, refusal, ...priorTimeoutField(refusal, records) })
}

const decideForMutant = (
  mutant: Mutant.Mutant,
  command: IncrementalDiffCommand,
  recordsById: Record.ReadonlyRecord<Mutant.MutantId, readonly PreviousReuseRecord[]>,
): IncrementalDiffDecision => {
  const records = Option.getOrElse(Record.get(recordsById, mutant.id), () => NO_PREVIOUS_RECORDS)
  return Boolean.match(flakyDependent(command, mutant), {
    onTrue: () => flakyRefusedOf(mutant, records),
    onFalse: () =>
      Option.match(newestMatchingOf(records, command), {
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
