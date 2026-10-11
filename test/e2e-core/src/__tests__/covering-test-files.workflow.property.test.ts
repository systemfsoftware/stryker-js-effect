import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { coveringTestFiles, CoveringTestFilesCommand } from '../covering-test-files.workflow.js'

const commandOf = (report: string): CoveringTestFilesCommand => CoveringTestFilesCommand.make({ report })

const fileNamesArb = Arbitrary.array(Arbitrary.schema(S.NonEmptyString), { maxLength: 4 })

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
})
