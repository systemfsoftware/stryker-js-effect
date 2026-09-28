import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  incrementalDiff,
  IncrementalDiffCommand,
  type IncrementalDiffDecision,
  MutantRemembered,
  MutantToRun,
} from '../incremental-diff.workflow.js'
import { type PreviousReuseRecord, ReuseRefusalReasonSchema } from '../IncrementalDiff.schema.js'
import { PreviousReuseRecordSchema } from '../IncrementalDiff.schema.js'

const FILE = Mutant.CanonicalFileName.make('src/subject.ts')

const mutantOf = (id: Mutant.MutantId): Mutant.Mutant =>
  Mutant.Mutant.make({
    id,
    fileName: FILE,
    mutatorName: Mutant.MutatorName.make('ArithmeticOperator'),
    replacement: '',
    location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
  })

const isReusable = S.is(Mutant.RememberedStatusSchema)

const recordOf = (
  mutantId: Mutant.MutantId,
  status: Mutant.MutantStatus,
  closureDigest: string | undefined,
  overrides: Partial<PreviousReuseRecord> = {},
): PreviousReuseRecord => ({
  mutantId,
  status,
  ...(closureDigest === undefined ? {} : { closureDigest }),
  verdictSemanticsVersion: 1,
  mutantSetPolicy: 'default',
  runInputsDigest: 'run-inputs',
  ...overrides,
})

interface CommandFields {
  readonly closureDigestsByMutantId?: Readonly<Record<string, string>>
  readonly closureAnalysisFailed?: boolean
  readonly verdictSemanticsVersion?: number
  readonly mutantSetPolicy?: Options.MutantSetPolicy
  readonly runInputsDigest?: string
  readonly force?: boolean
  readonly previousRecords?: ReadonlyArray<PreviousReuseRecord>
}

const commandOf = (
  currentMutants: ReadonlyArray<Mutant.Mutant>,
  previousRecords: ReadonlyArray<PreviousReuseRecord>,
  fields: CommandFields = {},
): IncrementalDiffCommand =>
  IncrementalDiffCommand.make({
    currentMutants: [...currentMutants],
    previousRecords: [...(fields.previousRecords ?? previousRecords)],
    closureDigestsByMutantId: fields.closureDigestsByMutantId ?? {},
    closureAnalysisFailed: fields.closureAnalysisFailed ?? false,
    verdictSemanticsVersion: fields.verdictSemanticsVersion ?? 1,
    mutantSetPolicy: fields.mutantSetPolicy ?? 'default',
    runInputsDigest: fields.runInputsDigest ?? 'run-inputs',
    force: fields.force ?? false,
  })

const matchingCommandOf = (
  record: PreviousReuseRecord,
  fields: CommandFields = {},
) =>
  commandOf([mutantOf(record.mutantId)], [record], {
    closureDigestsByMutantId: { [record.mutantId]: record.closureDigest ?? '' },
    verdictSemanticsVersion: record.verdictSemanticsVersion,
    mutantSetPolicy: record.mutantSetPolicy,
    runInputsDigest: record.runInputsDigest,
    ...fields,
  })

const onlyDecision = (
  result: Result.Result<readonly IncrementalDiffDecision[], never>,
): IncrementalDiffDecision | undefined =>
  Result.isSuccess(result) && result.success.length === 1 ? result.success[0] : undefined

const runsWithRefusal = (
  result: Result.Result<readonly IncrementalDiffDecision[], never>,
  refusal: string,
): boolean =>
  Result.isSuccess(result) && result.success.length === 1 &&
  S.is(MutantToRun)(result.success[0]) && result.success[0].refusal === refusal

const partitionCommandArb = Arbitrary.schema(
  S.Array(S.Struct({
    id: Mutant.MutantId,
    digest: S.String,
    status: Mutant.MutantStatusSchema,
  })),
).pipe(
  Arbitrary.map((entries) =>
    commandOf(
      entries.map((entry) => mutantOf(entry.id)),
      entries.map((entry) => recordOf(entry.id, entry.status, entry.digest)),
      { closureDigestsByMutantId: Object.fromEntries(entries.map((entry) => [entry.id, entry.digest])) },
    )
  ),
)

describe('incrementalDiff', () => {
  it.prop(
    '∀m_Mutants_≡ForceRunsEveryMutantInOrderNamingNoPriorRecord',
    { of: [S.Array(Mutant.MutantId)], subject: incrementalDiff },
    (subject, [ids]) => {
      const mutants = ids.map(mutantOf)
      const result = subject(commandOf(mutants, [], { force: true }))
      return Result.isSuccess(result) && result.success.length === mutants.length &&
        result.success.every((decision, index) =>
          S.is(MutantToRun)(decision) && decision.mutant.id === mutants[index]?.id &&
          decision.refusal === 'noPriorRecord'
        )
    },
  )

  it.prop(
    '∀m_Mutants_≡WithoutAPriorRecordEveryMutantRunsNamingNoPriorRecord',
    { of: [S.Array(Mutant.MutantId)], subject: incrementalDiff },
    (subject, [ids]) => {
      const mutants = ids.map(mutantOf)
      const result = subject(commandOf(mutants, []))
      return Result.isSuccess(result) && result.success.length === mutants.length &&
        result.success.every((decision) => S.is(MutantToRun)(decision) && decision.refusal === 'noPriorRecord')
    },
  )

  it.prop(
    '∀r_Record_≡AMatchingCacheKeyRemembersExactlyTheReusableStatuses',
    { of: [PreviousReuseRecordSchema], subject: incrementalDiff },
    (subject, [record]) => {
      const decision = onlyDecision(subject(matchingCommandOf(record)))
      if (decision === undefined) {
        return false
      }
      return isReusable(record.status)
        ? S.is(MutantRemembered)(decision) && decision.mutantId === record.mutantId && decision.status === record.status
        : S.is(MutantToRun)(decision) && decision.refusal === 'noPriorRecord'
    },
  )

  it.prop(
    '∀is_RecordAndDigest_≡AChangedClosureDigestRunsNamingClosureChanged',
    { of: [PreviousReuseRecordSchema, S.NonEmptyString], subject: incrementalDiff },
    (subject, [record, drawn]) => {
      const current = record.closureDigest ?? ''
      const changed = drawn === current ? `${drawn}-changed` : drawn
      const result = subject(matchingCommandOf(record, {
        closureDigestsByMutantId: { [record.mutantId]: changed },
      }))
      return runsWithRefusal(result, 'closureChanged')
    },
  )

  it.prop(
    '∀r_Record_≡SemanticsOutranksEveryOtherRefusal',
    { of: [PreviousReuseRecordSchema], subject: incrementalDiff },
    (subject, [record]) => {
      const result = subject(commandOf([mutantOf(record.mutantId)], [record], {
        closureDigestsByMutantId: { [record.mutantId]: `${record.closureDigest ?? ''}-drifted` },
        verdictSemanticsVersion: record.verdictSemanticsVersion + 1,
        mutantSetPolicy: record.mutantSetPolicy === 'default' ? 'full' : 'default',
        runInputsDigest: `${record.runInputsDigest}-drifted`,
      }))
      return runsWithRefusal(result, 'semanticsChanged')
    },
  )

  it.prop(
    '∀r_Record_≡PolicyOutranksRunInputsAndClosure',
    { of: [PreviousReuseRecordSchema], subject: incrementalDiff },
    (subject, [record]) => {
      const result = subject(commandOf([mutantOf(record.mutantId)], [record], {
        closureDigestsByMutantId: { [record.mutantId]: `${record.closureDigest ?? ''}-drifted` },
        verdictSemanticsVersion: record.verdictSemanticsVersion,
        mutantSetPolicy: record.mutantSetPolicy === 'default' ? 'full' : 'default',
        runInputsDigest: `${record.runInputsDigest}-drifted`,
      }))
      return runsWithRefusal(result, 'policyChanged')
    },
  )

  it.prop(
    '∀r_RecordWithAKey_≡AFailedClosureAnalysisRunsNamingClosureChanged',
    { of: [PreviousReuseRecordSchema], subject: incrementalDiff },
    (subject, [record]) =>
      runsWithRefusal(subject(matchingCommandOf(record, { closureAnalysisFailed: true })), 'closureChanged'),
  )

  it.prop(
    '∀r_Record_≡RunInputsOutrankClosure',
    { of: [PreviousReuseRecordSchema], subject: incrementalDiff },
    (subject, [record]) => {
      const result = subject(commandOf([mutantOf(record.mutantId)], [record], {
        closureDigestsByMutantId: { [record.mutantId]: `${record.closureDigest ?? ''}-drifted` },
        verdictSemanticsVersion: record.verdictSemanticsVersion,
        mutantSetPolicy: record.mutantSetPolicy,
        runInputsDigest: `${record.runInputsDigest}-drifted`,
      }))
      return runsWithRefusal(result, 'runInputsChanged')
    },
  )

  it.prop(
    '∀iss_Records_≡TheNewerOfTwoRecordsWithTheSameKeyWins',
    {
      of: [Mutant.MutantId, Mutant.MutantStatusSchema, Mutant.MutantStatusSchema],
      subject: incrementalDiff,
    },
    (subject, [id, olderStatus, newerStatus]) => {
      const older = recordOf(id, olderStatus, 'digest')
      const newer = recordOf(id, newerStatus, 'digest')
      const decision = onlyDecision(subject(matchingCommandOf(older, { previousRecords: [older, newer] })))
      if (decision === undefined) {
        return false
      }
      const reusableInOrder = isReusable(newer.status) ? newer : older
      const expected = isReusable(reusableInOrder.status) ? reusableInOrder : undefined
      return expected === undefined
        ? S.is(MutantToRun)(decision)
        : S.is(MutantRemembered)(decision) && decision.status === expected.status
    },
  )

  it.prop(
    '∀c_Command_≡DecisionsPartitionThePlannedMutants',
    { of: [partitionCommandArb], subject: incrementalDiff },
    (subject, [command]) => {
      const result = subject(command)
      return Result.isSuccess(result) && result.success.length === command.currentMutants.length &&
        Arr.every(result.success, (decision) =>
          S.is(MutantRemembered)(decision)
            ? isReusable(decision.status)
            : S.is(MutantToRun)(decision) && S.is(ReuseRefusalReasonSchema)(decision.refusal))
    },
  )
})
