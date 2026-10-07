import { Checker, Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

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

const unreproducedWallClock = (record: PreviousReuseRecord): boolean =>
  record.status === 'Timeout' && record.timeoutKind !== 'hitLimit' && (record.reproductions ?? 0) < 1

const matchingProgramRecordDigest = (record: PreviousReuseRecord, digest: string | undefined): boolean =>
  (record.programDigest ?? '') !== '' && record.programDigest === digest

const remembersWith = (record: PreviousReuseRecord, programDigest: string | undefined): boolean =>
  isReusable(record.status) &&
  !unreproducedWallClock(record) &&
  (record.status === 'CompileError' ? matchingProgramRecordDigest(record, programDigest) : true)

const remembers = (record: PreviousReuseRecord): boolean => remembersWith(record, record.programDigest)

const refusalOfTheMatchingCommand = (record: PreviousReuseRecord): string =>
  record.status === 'CompileError' && (record.programDigest ?? '') === ''
    ? 'programChanged'
    : unreproducedWallClock(record)
    ? 'timeoutUnreproduced'
    : 'noPriorRecord'

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
  readonly programDigest?: string
  readonly force?: boolean
  readonly previousRecords?: ReadonlyArray<PreviousReuseRecord>
  readonly flakyMutantIds?: ReadonlyArray<Mutant.MutantId>
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
    ...(fields.programDigest === undefined ? {} : { programDigest: fields.programDigest }),
    force: fields.force ?? false,
    ...(fields.flakyMutantIds === undefined ? {} : { flakyMutantIds: [...fields.flakyMutantIds] }),
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
    ...(record.programDigest === undefined ? {} : { programDigest: record.programDigest }),
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

interface PartitionEntry {
  readonly id: Mutant.MutantId
  readonly digest: string
  readonly status: Mutant.MutantStatus
}

const partitionCommandOf = (entries: readonly PartitionEntry[]) =>
  commandOf(
    entries.map((entry) => mutantOf(entry.id)),
    entries.map((entry) => recordOf(entry.id, entry.status, entry.digest)),
    { closureDigestsByMutantId: Object.fromEntries(entries.map((entry) => [entry.id, entry.digest])) },
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
      return remembersWith(record, record.programDigest)
        ? S.is(MutantRemembered)(decision) && decision.mutantId === record.mutantId && decision.status === record.status
        : S.is(MutantToRun)(decision) && decision.refusal === refusalOfTheMatchingCommand(record)
    },
  )

  it.prop(
    '∀r_RecordWithAProgramDigest_≡AMatchingProgramDigestRemembersACompileError',
    { of: [PreviousReuseRecordSchema], subject: incrementalDiff },
    (subject, [record]) => {
      const programDigest = 'a'.repeat(64)
      const prior = { ...record, status: 'CompileError' as const, programDigest }
      const decision = onlyDecision(subject(matchingCommandOf(prior)))
      return decision !== undefined && S.is(MutantRemembered)(decision) && decision.status === 'CompileError'
    },
  )

  it.prop(
    '∀rd_RecordAndDigest_≡AChangedProgramDigestRunsNamingProgramChanged',
    { of: [PreviousReuseRecordSchema, Checker.ProgramDigest], subject: incrementalDiff },
    (subject, [record, drawn]) => {
      const programDigest = 'a'.repeat(64)
      const current = drawn === programDigest ? `b${drawn.slice(1)}` : drawn
      const prior = { ...record, status: 'CompileError' as const, programDigest }
      return runsWithRefusal(subject(matchingCommandOf(prior, { programDigest: current })), 'programChanged')
    },
  )

  it.prop(
    '∀r_Record_≡ACompileErrorWithoutAProgramDigestRunsNamingProgramChanged',
    { of: [PreviousReuseRecordSchema], subject: incrementalDiff },
    (subject, [record]) => {
      const { programDigest: _absent, ...withoutProgramDigest } = record
      const prior = { ...withoutProgramDigest, status: 'CompileError' as const }
      return runsWithRefusal(subject(matchingCommandOf(prior)), 'programChanged')
    },
  )

  it.prop(
    '∀rd_RecordAndReproductions_≡AWallClockTimeoutIsRememberedExactlyWhenItReproduced',
    { of: [PreviousReuseRecordSchema, S.Natural], subject: incrementalDiff },
    (subject, [record, reproductions]) => {
      const prior = { ...record, status: 'Timeout' as const, timeoutKind: 'wallClock' as const, reproductions }
      const decision = onlyDecision(subject(matchingCommandOf(prior)))
      if (decision === undefined) {
        return false
      }
      return reproductions >= 1
        ? S.is(MutantRemembered)(decision) && decision.status === 'Timeout' && decision.timeoutKind === 'wallClock' &&
          decision.reproductions === reproductions
        : S.is(MutantToRun)(decision) && decision.refusal === 'timeoutUnreproduced' &&
          decision.priorTimeout?.timeoutKind === 'wallClock'
    },
  )

  it.prop(
    '∀r_Record_≡AHitLimitTimeoutIsRememberedOnFirstSight',
    { of: [PreviousReuseRecordSchema], subject: incrementalDiff },
    (subject, [record]) => {
      const prior = { ...record, status: 'Timeout' as const, timeoutKind: 'hitLimit' as const, reproductions: 0 }
      const decision = onlyDecision(subject(matchingCommandOf(prior)))
      return decision !== undefined && S.is(MutantRemembered)(decision) && decision.status === 'Timeout'
    },
  )

  it.prop(
    '∀is_RecordAndDigest_≡AChangedClosureDigestNamesClosureChangedUnlessTheRecordIsACompileError',
    { of: [PreviousReuseRecordSchema, S.NonEmptyString], subject: incrementalDiff },
    (subject, [record, drawn]) => {
      const current = record.closureDigest ?? ''
      const changed = drawn === current ? `${drawn}-changed` : drawn
      const decision = onlyDecision(subject(matchingCommandOf(record, {
        closureDigestsByMutantId: { [record.mutantId]: changed },
      })))
      if (decision === undefined) {
        return false
      }
      return record.status === 'CompileError'
        ? !S.is(MutantToRun)(decision) || decision.refusal !== 'closureChanged'
        : S.is(MutantToRun)(decision) && decision.refusal === 'closureChanged'
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
    '∀r_RecordWithAKey_≡AFailedClosureAnalysisNamesTheProgramGateForAnUnkeyedCompileError',
    { of: [PreviousReuseRecordSchema], subject: incrementalDiff },
    (subject, [record]) => {
      const result = subject(matchingCommandOf(record, { closureAnalysisFailed: true }))
      return record.status === 'CompileError' && (record.programDigest ?? '') === ''
        ? runsWithRefusal(result, 'programChanged')
        : runsWithRefusal(result, 'closureChanged')
    },
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
      const reusableInOrder = remembers(newer) ? newer : remembers(older) ? older : undefined
      return reusableInOrder === undefined
        ? S.is(MutantToRun)(decision)
        : S.is(MutantRemembered)(decision) && decision.status === reusableInOrder.status
    },
  )

  it.prop(
    '∀rf_RecordAndFlakyId_≡AStaticMutantIsFlakyDependentWheneverTheFlakeSetIsNotEmpty',
    { of: [PreviousReuseRecordSchema, Mutant.MutantId], subject: incrementalDiff },
    (subject, [record, flakyId]) => {
      const mutant = Mutant.Mutant.make({ ...mutantOf(record.mutantId), static: true })
      const result = subject(commandOf([mutant], [record], {
        closureDigestsByMutantId: { [record.mutantId]: record.closureDigest ?? '' },
        verdictSemanticsVersion: record.verdictSemanticsVersion,
        mutantSetPolicy: record.mutantSetPolicy,
        runInputsDigest: record.runInputsDigest,
        flakyMutantIds: [flakyId],
      }))
      return runsWithRefusal(result, 'flakyDependency')
    },
  )

  it.prop(
    '∀d_ProgramDigest_≡AKeyedCompileErrorRecordIsRememberedByItsOwnDigestAndRunsUnderAnother',
    { of: [Checker.ProgramDigest], subject: incrementalDiff },
    (subject, [drawn]) => {
      const id = Mutant.MutantId.make('0000000000000000')
      const digest = 'a'.repeat(64)
      const current = drawn === digest ? `b${drawn.slice(1)}` : drawn
      const record = recordOf(id, 'CompileError', 'digest', { programDigest: digest })
      const remembered = onlyDecision(subject(matchingCommandOf(record)))
      const refused = onlyDecision(subject(matchingCommandOf(record, { programDigest: current })))
      return remembered !== undefined &&
        S.is(MutantRemembered)(remembered) &&
        remembered.mutantId === id &&
        remembered.status === 'CompileError' &&
        refused !== undefined &&
        S.is(MutantToRun)(refused) &&
        refused.mutant.id === id &&
        refused.refusal === 'programChanged'
    },
  )

  it.prop(
    '∀c_Command_≡DecisionsPartitionThePlannedMutants',
    {
      of: [S.Array(S.Struct({ id: Mutant.MutantId, digest: S.String, status: Mutant.MutantStatusSchema }))],
      subject: incrementalDiff,
    },
    (subject, [entries]) => {
      const command = partitionCommandOf(entries)
      const result = subject(command)
      return Result.isSuccess(result) && result.success.length === command.currentMutants.length &&
        Arr.every(result.success, (decision) =>
          S.is(MutantRemembered)(decision)
            ? isReusable(decision.status)
            : S.is(MutantToRun)(decision) && S.is(ReuseRefusalReasonSchema)(decision.refusal))
    },
  )
})
