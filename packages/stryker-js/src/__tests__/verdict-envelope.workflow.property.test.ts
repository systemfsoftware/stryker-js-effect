import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { actionableMutants, buildVerdictEnvelope, generateRunId } from '../reporting/verdict-envelope.js'

const pathService = Effect.runSync(Effect.provide(Path.Path, Path.layer))
const fixedRunId = generateRunId(DateTime.makeUnsafe(0))

const ACTIONABLE_STATUSES: Readonly<Record<string, true>> = Object.fromEntries(
  Mutant.ActionableStatusSchema.literals.map((status) => [status, true] as const),
)

const mutantTotalOf = (report: Report.MutationTestResult): number =>
  Object.values(report.files).reduce((total, file) => total + file.mutants.length, 0)

const actionableIdsOf = (files: Report.FileResultDictionary): ReadonlyArray<string> =>
  Arr.flatMap(
    Object.values(files),
    (file) => file.mutants.filter((mutant) => ACTIONABLE_STATUSES[mutant.status] === true).map((mutant) => mutant.id),
  )

const budgetOf = (report: Report.MutationTestResult): RunEvent.Budget =>
  Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(report['budget']), (raw) => S.decodeUnknownOption(RunEvent.Budget)(raw)),
    () => RunEvent.Budget.make({ predictedSeconds: 0, actualSeconds: 0 }),
  )

describe('buildVerdictEnvelope', () => {
  it.prop(
    '∀r_EnvelopeCounts_≡EveryMutantCounted',
    { of: [Report.MutationTestResult], subject: buildVerdictEnvelope },
    (subject, [report]) => {
      const { counts } = subject(report, 'machine', 'flag', fixedRunId, '/base', pathService, Option.none(), null)
      return counts.totalMutants === mutantTotalOf(report)
    },
  )

  it.prop(
    '∀r_Report_≡TheEnvelopeReusesVerdictsExactlyWhenIncrementalIsOnAndNotForced',
    { of: [Report.MutationTestResult], subject: buildVerdictEnvelope },
    (subject, [report]) => {
      const { incrementalMode } = subject(
        report,
        'machine',
        'flag',
        fixedRunId,
        '/base',
        pathService,
        Option.none(),
        null,
      )
      const config = report.config ?? {}
      const reuses = config['incremental'] === true && config['force'] !== true
      return incrementalMode === (reuses ? 'incremental' : 'full')
    },
  )

  it.prop(
    '∀r_EnvelopeBudget_≡CarriedFromReport',
    { of: [Report.MutationTestResult], subject: buildVerdictEnvelope },
    (subject, [report]) => {
      const { budget } = subject(report, 'machine', 'flag', fixedRunId, '/base', pathService, Option.none(), null)
      const expected = budgetOf(report)
      return budget.predictedSeconds === expected.predictedSeconds && budget.actualSeconds === expected.actualSeconds
    },
  )
})

describe('actionableMutants', () => {
  it.prop(
    '∀files_ActionableMutants_≡ActionableOnly',
    { of: [Report.FileResultDictionary], subject: actionableMutants },
    (subject, [files]) => {
      const observed = subject(files)
      const expected = actionableIdsOf(files)
      return (
        observed.length === expected.length &&
        observed.every((mutant, index) => mutant.id === expected[index]) &&
        observed.every((mutant) => ACTIONABLE_STATUSES[mutant.status] === true)
      )
    },
  )
})

describe('generateRunId', () => {
  it.prop(
    '∀bd_RunIdTimePrefix_≤ForLaterEpoch',
    {
      of: [
        S.Int.check(S.isBetween({ minimum: 0, maximum: 2 ** 40 - 2 ** 16 })),
        S.Int.check(S.isBetween({ minimum: 8, maximum: 2 ** 16 })),
      ],
      subject: generateRunId,
    },
    (subject, [base, delta]) =>
      subject(DateTime.makeUnsafe(base)).slice(0, 9) < subject(DateTime.makeUnsafe(base + delta)).slice(0, 9),
  )
})
