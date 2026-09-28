import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { decodeReport, DecodeReportCommand, ReportUndecodable } from '../decode-report.workflow.js'

const UNDECODABLE_TEXTS = ['', 'not json', '{}', '{"schemaVersion":"9"}', '[]', 'null'] as const

const reportTextOf = (file: string, mutatorName: string, status: Mutant.MutantStatus): string =>
  JSON.stringify({
    schemaVersion: '1.0',
    thresholds: { high: 80, low: 60 },
    files: {
      [file]: {
        language: 'typescript',
        source: 'const subject = 1 + 1',
        mutants: [
          {
            id: '0000000000000001',
            mutatorName,
            location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
            status,
          },
        ],
      },
    },
  })

describe('decodeReport', () => {
  it.prop(
    '∀m_ReportDocument_≡DecodedUnderTheReportContract',
    { of: [S.NonEmptyString, Mutant.MutatorName, Mutant.MutantStatusSchema], subject: decodeReport },
    (subject, [file, mutatorName, status]) => {
      const text = reportTextOf(file, mutatorName, status)
      return Result.match(subject(DecodeReportCommand.make({ file: 'reports/mutation-report.json', text })), {
        onFailure: () => false,
        onSuccess: (decoded) => {
          const result = decoded.report.files[file]
          return result.mutants.length === 1 &&
            result.mutants[0].mutatorName === mutatorName &&
            result.mutants[0].status === status
        },
      })
    },
  )

  it.prop(
    '∀t_TextOutsideTheReportContract_≡RefusedNamingTheFile',
    { of: [S.Literals(UNDECODABLE_TEXTS)], subject: decodeReport },
    (subject, [text]) =>
      Result.match(subject(DecodeReportCommand.make({ file: 'reports/mutation-report.json', text })), {
        onFailure: (failure) => S.is(ReportUndecodable)(failure) && failure.file === 'reports/mutation-report.json',
        onSuccess: () => false,
      }),
  )
})
