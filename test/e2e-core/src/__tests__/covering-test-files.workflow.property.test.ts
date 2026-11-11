import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { coveringTestFiles, CoveringTestFilesCommand } from '../covering-test-files.workflow.js'

const commandOf = (report: string): CoveringTestFilesCommand => CoveringTestFilesCommand.make({ report })

const fileNamesArb = Arbitrary.array(Arbitrary.schema(S.NonEmptyString), { maxLength: 4 })

const TEST_FILES = {
  'test/c.test.ts': { tests: [{ id: 'c1' }] },
  'test/a.test.ts': { tests: [{ id: 'a1' }, { id: 'a2' }] },
  'test/b.test.ts': { tests: [{ id: 'b1' }, { id: 'unused' }] },
}

describe('coveringTestFiles', () => {
  it.prop(
    '∀n_MutatedFileNames_≡SortedDistinctReportKeysWithNoCoveringTestFiles',
    { of: [fileNamesArb], subject: coveringTestFiles },
    (subject, [fileNames]) => {
      const files = Object.fromEntries(fileNames.map((fileName) => [fileName, { mutants: [] }]))
      const expected = [...new Set(fileNames)].sort()
      return Result.match(subject(commandOf(JSON.stringify({ files, testFiles: {} }))), {
        onFailure: () => false,
        onSuccess: (found) =>
          found.testFiles.length === 0 &&
          found.mutatedFiles.length === expected.length &&
          found.mutatedFiles.every((fileName, index) => fileName === expected[index]),
      })
    },
  )

  it.prop(
    '∀i_CoveringId_≡ResolvedToItsTestFileOrRefusedWhenNoTestFileDeclaresIt',
    { of: [S.NonEmptyString], subject: coveringTestFiles },
    (subject, [coveringId]) => {
      const report = JSON.stringify({
        files: { 'src/a.ts': { mutants: [{ coveredBy: [coveringId] }] } },
        testFiles: { 'test/a.test.ts': { tests: [{ id: 'declared' }] } },
      })
      return Result.match(subject(commandOf(report)), {
        onFailure: (failure) => coveringId !== 'declared' && failure.reason.includes(coveringId),
        onSuccess: (found) => coveringId === 'declared' && found.testFiles.join() === 'test/a.test.ts',
      })
    },
  )

  it.prop(
    '∀cf_CoveredIds_≡SortedDistinctTestFilesHoldingThem',
    { of: [S.Boolean, S.Boolean, S.Boolean, S.Boolean], subject: coveringTestFiles },
    (subject, [a1, a2, b1, c1]) => {
      const files = {
        'src/b.ts': { mutants: [{ coveredBy: [...(a1 ? ['a1'] : []), ...(c1 ? ['c1'] : [])] }] },
        'src/a.ts': { mutants: [{ coveredBy: [...(a2 ? ['a2'] : []), ...(b1 ? ['b1'] : []), ...(a1 ? ['a1'] : [])] }] },
      }
      const expected = [
        ...(a1 || a2 ? ['test/a.test.ts'] : []),
        ...(b1 ? ['test/b.test.ts'] : []),
        ...(c1 ? ['test/c.test.ts'] : []),
      ]
      return Result.match(subject(commandOf(JSON.stringify({ files, testFiles: TEST_FILES }))), {
        onFailure: () => false,
        onSuccess: (found) => found.testFiles.join('\n') === expected.join('\n'),
      })
    },
  )

  it.prop(
    '∀mj_ReportTextWithANonJsonLeadCharacter_≡Refused',
    { of: [S.String], subject: coveringTestFiles },
    (subject, [tail]) => Result.isFailure(subject(commandOf(`x${tail}`))),
  )
})
