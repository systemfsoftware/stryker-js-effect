import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  ProjectFilesDiscovered,
  ProjectFilesNoneDiscovered,
  ProjectSelectionCommand,
  selectProjectFiles,
} from '../select-project-files.workflow.js'

const segmentArb = Arbitrary.schema(S.String.check(S.isPattern(/^[a-z][a-z0-9]{0,4}$/)))

const lineArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 1, maximum: 500 })))
const columnArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 1, maximum: 200 })))

const VITEST_TEST_PATTERNS = ['**/*.{test,spec}.{js,jsx,ts,tsx,cjs,cjsx,cts,ctsx,mjs,mjsx,mts,mtsx}']
const VITEST_TEST_IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.{idea,git,cache,output,temp}/**',
  '**/.stryker-tmp/**',
]

const decisionOf = (select: typeof selectProjectFiles, command: ProjectSelectionCommand) => {
  const result = select(command)
  return Result.isSuccess(result) ? result.success : undefined
}

const descriptionsOf = (select: typeof selectProjectFiles, command: ProjectSelectionCommand) => {
  const decision = decisionOf(select, command)
  return decision !== undefined && S.is(ProjectFilesDiscovered)(decision) ? decision.fileDescriptions : undefined
}

const testFilesOf = (select: typeof selectProjectFiles, command: ProjectSelectionCommand) => {
  const decision = decisionOf(select, command)
  return decision !== undefined && S.is(ProjectFilesDiscovered)(decision) ? [...decision.testFiles] : undefined
}

describe('selectProjectFiles', () => {
  it.prop(
    '∀c_EmptyInputs_≡NoneDiscovered',
    { of: [ProjectSelectionCommand], subject: selectProjectFiles },
    (subject, [command]) =>
      command.inputFileNames.length > 0 ||
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) => S.is(ProjectFilesNoneDiscovered)(decision),
      }),
  )

  it.prop(
    '∀fs_Selection_≡ExclusionRefusesExcludedFiles',
    { of: [Arbitrary.all({ a: segmentArb, b: segmentArb, c: segmentArb })], subject: selectProjectFiles },
    (subject, [draw]) => {
      const files = [`/p/${draw.a}.ts`, `/p/${draw.b}.ts`, `/p/${draw.c}.ts`]
      const includes = (file: string, segment: string) => file.endsWith(`/${segment}.ts`)
      const descriptions = descriptionsOf(
        subject,
        ProjectSelectionCommand.make({
          inputFileNames: files,
          mutatePatterns: [`**/${draw.a}.ts`, `!**/${draw.b}.ts`],
          testFilePatterns: [],
          basePath: '/',
        }),
      )
      return (
        descriptions !== undefined &&
        files.every((file) => descriptions[file]?.mutate === (includes(file, draw.a) && !includes(file, draw.b)))
      )
    },
  )

  it.prop(
    '∀fs_Selection_≡TargetRestrictsMutationToTargetedFiles',
    { of: [Arbitrary.all({ a: segmentArb, b: segmentArb })], subject: selectProjectFiles },
    (subject, [draw]) => {
      const files = [`/p/${draw.a}.ts`, `/p/${draw.b}.ts`]
      const descriptions = descriptionsOf(
        subject,
        ProjectSelectionCommand.make({
          inputFileNames: files,
          mutatePatterns: ['**/*.ts'],
          targetMutatePatterns: [`**/${draw.a}.ts`],
          testFilePatterns: [],
          basePath: '/',
        }),
      )
      return (
        descriptions !== undefined &&
        files.every((file) => descriptions[file]?.mutate === file.endsWith(`/${draw.a}.ts`))
      )
    },
  )

  it.prop(
    '∀s_Range_≡MutationRangeSelectsOneBasedSpan',
    { of: [Arbitrary.all({ a: segmentArb, line: lineArb, column: columnArb })], subject: selectProjectFiles },
    (subject, [draw]) => {
      const file = `/p/${draw.a}.ts`
      const descriptions = descriptionsOf(
        subject,
        ProjectSelectionCommand.make({
          inputFileNames: [file],
          mutatePatterns: [`${file}:${draw.line}:${draw.column}-${draw.line + 1}:${draw.column + 1}`],
          testFilePatterns: [],
          basePath: '/',
        }),
      )
      return (
        descriptions !== undefined &&
        JSON.stringify(descriptions[file]?.mutate) ===
          JSON.stringify([
            {
              start: { line: draw.line, column: draw.column },
              end: { line: draw.line + 1, column: draw.column + 1 },
            },
          ])
      )
    },
  )

  it.prop(
    '∀f_Discovery_≡TestFilesExcludeNodeModulesAndNonTestFiles',
    { of: [Arbitrary.all({ a: segmentArb, b: segmentArb })], subject: selectProjectFiles },
    (subject, [draw]) => {
      const testFile = `/project/src/${draw.a}.test.ts`
      const excludedTestFile = `/project/node_modules/${draw.b}.test.ts`
      const plainFile = `/project/src/${draw.a}.ts`
      const testFiles = testFilesOf(
        subject,
        ProjectSelectionCommand.make({
          inputFileNames: [testFile, excludedTestFile, plainFile],
          mutatePatterns: [],
          testFilePatterns: VITEST_TEST_PATTERNS,
          testFileIgnores: VITEST_TEST_IGNORES,
          basePath: '/',
        }),
      )
      return testFiles !== undefined && [...testFiles].sort().join('\n') === [testFile].sort().join('\n')
    },
  )
})
