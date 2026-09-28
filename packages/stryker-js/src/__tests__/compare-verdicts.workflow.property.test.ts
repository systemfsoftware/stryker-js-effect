import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  compareVerdicts,
  CompareVerdictsCommand,
  type VerdictMismatch,
  type VerdictReport,
  VerdictSchema,
  VerdictsDiffer,
  VerdictsMatch,
} from '../compare-verdicts.workflow.js'

const idsOf = (report: VerdictReport): readonly string[] =>
  Object.values(report.files).flatMap((file) => file.mutants.map((mutant) => mutant.id))

const uniqueIdsOf = (report: VerdictReport): readonly string[] => [...new Set(idsOf(report))]

const flipStatus = (status: string): string => (status === 'Killed' ? 'Survived' : 'Killed')

const flippedReport = (report: VerdictReport): VerdictReport => ({
  files: Object.fromEntries(
    Object.entries(report.files).map(([file, value]) => [
      file,
      { mutants: value.mutants.map((mutant) => ({ ...mutant, status: flipStatus(mutant.status) })) },
    ]),
  ),
})

const mismatchesOf = (
  compared: Result.Result<VerdictsMatch, VerdictsDiffer>,
): readonly VerdictMismatch[] =>
  Result.match(compared, { onFailure: (differ) => differ.mismatches, onSuccess: () => [] })

const listedIdsOf = (compared: Result.Result<VerdictsMatch, VerdictsDiffer>): readonly string[] =>
  mismatchesOf(compared).map((mismatch) => mismatch.id)

const commandOf = (
  baseline: VerdictReport,
  fresh: VerdictReport,
  noise: readonly string[],
): CompareVerdictsCommand => CompareVerdictsCommand.make({ baseline, fresh, noise })

const inIdOrder = (ids: readonly string[]): boolean =>
  ids.every((id, index) => index === 0 || (ids[index - 1] ?? '') <= id)

const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((id) => right.includes(id))

describe('compareVerdicts', () => {
  it.prop(
    '∀r_Verdict_≡IdenticalReportsMatch',
    { of: [VerdictSchema], subject: compareVerdicts },
    (subject, [report]) => Result.isSuccess(subject(commandOf(report, report, []))),
  )

  it.prop(
    '∀r_Verdict_≡EveryDifferingIdIsListedOnceInIdOrder',
    { of: [VerdictSchema], subject: compareVerdicts },
    (subject, [report]) => {
      const compared = subject(commandOf(report, flippedReport(report), []))
      const listed = listedIdsOf(compared)
      const expected = uniqueIdsOf(report)
      return sameIds(listed, expected) &&
        inIdOrder(listed) &&
        Result.isSuccess(compared) === (expected.length === 0)
    },
  )

  it.prop(
    '∀r_NoiseIds_≡NoiseSubtractsTheNamedIds',
    { of: [VerdictSchema, S.Array(S.String)], subject: compareVerdicts },
    (subject, [report, noiseIds]) => {
      const noise = [...new Set(noiseIds)]
      const compared = subject(commandOf(report, flippedReport(report), noise))
      const expected = uniqueIdsOf(report).filter((id) => !noise.includes(id))
      return sameIds(listedIdsOf(compared), expected)
    },
  )

  it.prop(
    '∀r_Verdict_≡ANoiseCoveringEveryIdMatches',
    { of: [VerdictSchema], subject: compareVerdicts },
    (subject, [report]) => Result.isSuccess(subject(commandOf(report, flippedReport(report), idsOf(report)))),
  )
})
