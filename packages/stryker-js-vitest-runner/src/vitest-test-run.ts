/// <reference types="vitest/importMeta" />
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type {
  VitestFailureFrame,
  VitestFileFailure,
  VitestTestRecord,
  VitestTestRun,
} from './vitest-run-command.schema.js'

type TestResultEncoded = (typeof TestRunner.TestResultSchema)['Encoded']

const UNKNOWN_FAILURE_MESSAGE = 'StrykerJS: Unknown test failure'
const UNKNOWN_FILE_NAME = 'unknown.js'
const SUITE_SEPARATOR = ' > '
const SKIPPED_MODES: Readonly<Record<string, boolean>> = { skip: true, todo: true }

const isSkippedMode = (mode: string | undefined): boolean =>
  Option.match(Option.fromNullishOr(mode), {
    onNone: () => false,
    onSome: (present) => SKIPPED_MODES[present] === true,
  })

const stripProjectRoot = (file: string, projectRoot: string): string =>
  Boolean.match(file.startsWith(projectRoot), {
    onTrue: () => file.slice(projectRoot.length),
    onFalse: () => file,
  })

const projectRelativePath = (file: string): string => file.replace(/^[/\\]+/, '').replaceAll('\\', '/')

const projectRelativeId = (id: string, projectRoot: string): string => {
  const hash = id.indexOf('#')
  return Boolean.match(hash === -1, {
    onTrue: () => id,
    onFalse: () => `${projectRelativePath(stripProjectRoot(id.slice(0, hash), projectRoot))}#${id.slice(hash + 1)}`,
  })
}

const projectRelativeFileOf = (record: VitestTestRecord, projectRoot: string): string =>
  projectRelativePath(stripProjectRoot(fileNameOf(record), projectRoot))

const reproduceArgvOf = (testName: string, file: string): readonly [string, ...string[]] =>
  Boolean.match(testName === file, {
    onTrue: (): readonly [string, ...string[]] => ['vitest', 'run', file],
    onFalse: (): readonly [string, ...string[]] => ['vitest', 'run', file, '-t', testName],
  })

const testNameOf = (record: VitestTestRecord): string =>
  Option.getOrElse(
    Option.fromNullishOr(record.fullTestName),
    () => [...record.suiteNames, record.name].join(SUITE_SEPARATOR).trim(),
  )

const isInternalFilePath = (file: string): boolean => file.startsWith('node:') || file.startsWith('file://')

const isNodeModulesPath = (file: string): boolean => file.split(/[/\\]/).includes('node_modules')

const hasSourcePosition = (frame: VitestFailureFrame): boolean => frame.line >= 1 && frame.column >= 1

const isExternalFrame = (frame: VitestFailureFrame): boolean => frame.file.length > 0 && !isInternalFilePath(frame.file)

const isProjectFileFrame = (frame: VitestFailureFrame): boolean =>
  isExternalFrame(frame) && !isNodeModulesPath(frame.file)

const isProjectSourceFrame = (frame: VitestFailureFrame): boolean =>
  isProjectFileFrame(frame) && hasSourcePosition(frame)

const locationOf = (
  frames: readonly VitestFailureFrame[] | undefined,
  projectRoot: string,
): Option.Option<TestRunner.TestFailureLocation> =>
  Option.flatMap(
    Option.fromNullishOr(frames),
    (present) =>
      Option.flatMap(
        Option.fromNullishOr(present.find(isProjectSourceFrame)),
        (frame) => {
          const file = projectRelativePath(stripProjectRoot(frame.file, projectRoot))
          return file.length > 0 ? Option.some({ file, line: frame.line, column: frame.column }) : Option.none()
        },
      ),
  )

const failureEvidenceOf = (
  location: Option.Option<TestRunner.TestFailureLocation>,
  stack: string | undefined,
): { readonly location?: TestRunner.TestFailureLocation; readonly stack?: string } => ({
  ...Option.match(location, {
    onNone: () => ({}),
    onSome: (present) => ({ location: present }),
  }),
  ...Option.match(Option.fromNullishOr(stack), {
    onNone: () => ({}),
    onSome: (present) => ({ stack: present }),
  }),
})

const testStatusOf = (record: VitestTestRecord): TestRunner.TestStatus =>
  Boolean.match(isSkippedMode(record.mode) || isSkippedMode(record.state), {
    onTrue: (): TestRunner.TestStatus => 'skipped',
    onFalse: (): TestRunner.TestStatus =>
      Boolean.match(record.state === 'pass', {
        onTrue: (): TestRunner.TestStatus => 'success',
        onFalse: (): TestRunner.TestStatus => 'failed',
      }),
  })

const failureMessageOf = (record: VitestTestRecord): string =>
  Option.getOrElse(Option.fromNullishOr(record.errorMessage), () => UNKNOWN_FAILURE_MESSAGE)

const fileNameOf = (record: VitestTestRecord): string =>
  Option.getOrElse(Option.fromNullishOr(record.fileName), () => UNKNOWN_FILE_NAME)

const timeSpentOf = (record: VitestTestRecord): number =>
  Option.getOrElse(Option.fromNullishOr(record.durationMs), () => 0)

const fileNameFieldOf = (record: VitestTestRecord): { readonly fileName?: string } =>
  Option.match(Option.fromNullishOr(record.fileName), {
    onNone: () => ({}),
    onSome: (fileName) => ({ fileName }),
  })

const failureEvidenceOfRecord = (
  record: VitestTestRecord,
  projectRoot: string,
): { readonly location?: TestRunner.TestFailureLocation; readonly stack?: string } =>
  failureEvidenceOf(locationOf(record.errorFrames, projectRoot), record.errorStack)

const resultOf = (record: VitestTestRecord, projectRoot: string): TestResultEncoded => {
  const name = testNameOf(record)
  const reproduce = reproduceArgvOf(name, projectRelativeFileOf(record, projectRoot))
  const base = {
    id: projectRelativeId(`${fileNameOf(record)}#${name}`, projectRoot),
    name,
    timeSpentMs: timeSpentOf(record),
    ...fileNameFieldOf(record),
  }
  return Match.value(testStatusOf(record)).pipe(
    Match.when(
      'failed',
      (): TestResultEncoded => ({
        ...base,
        status: 'failed',
        failureMessage: failureMessageOf(record),
        reproduce,
        ...failureEvidenceOfRecord(record, projectRoot),
      }),
    ),
    Match.when(
      'skipped',
      (): TestResultEncoded =>
        Option.match(Option.fromNullishOr(record.suiteErrorMessage), {
          onNone: (): TestResultEncoded => ({ ...base, status: 'skipped' }),
          onSome: (failureMessage): TestResultEncoded => ({
            ...base,
            status: 'failed',
            failureMessage,
            reproduce,
            ...failureEvidenceOfRecord(record, projectRoot),
          }),
        }),
    ),
    Match.orElse((): TestResultEncoded => ({ ...base, status: 'success' })),
  )
}

const fileFailureResultOf = (failure: VitestFileFailure, projectRoot: string): TestResultEncoded => {
  const file = projectRelativePath(stripProjectRoot(failure.fileName, projectRoot))
  return {
    id: `${file}#${file}`,
    name: file,
    timeSpentMs: 0,
    status: 'failed',
    failureMessage: failure.message,
    fileName: failure.fileName,
    reproduce: reproduceArgvOf(file, file),
    ...failureEvidenceOf(locationOf(failure.frames, projectRoot), failure.stack),
  }
}

export const interpretVitestTestRun = (run: VitestTestRun): readonly TestResultEncoded[] => [
  ...run.records.map((record) => resultOf(record, run.projectRoot)),
  ...run.fileFailures.map((failure) => fileFailureResultOf(failure, run.projectRoot)),
]

if (import.meta.vitest !== void 0) {
  // The test-only modules below are reached through `await import` because a static
  // import would put them on the production module graph.
  const { it } = await import('@systemfsoftware/vitest')
  const S = await import('effect/Schema')
  const Records = await import('./vitest-run-command.schema.js')

  const singleRecordRun = (record: VitestTestRecord, projectRoot: string): VitestTestRun => ({
    projectRoot,
    records: [record],
    fileFailures: [],
  })

  type FailedTestResultEncoded = Extract<TestResultEncoded, { status: 'failed' }>

  const isFailedResult = (only: TestResultEncoded): only is FailedTestResultEncoded => only.status === 'failed'

  const locationOfFailure = (
    only: TestResultEncoded,
  ): Option.Option<NonNullable<FailedTestResultEncoded['location']>> =>
    Option.flatMap(Option.liftPredicate(only, isFailedResult), (failed) => Option.fromNullishOr(failed.location))

  const reproduceOf = (only: TestResultEncoded): Option.Option<readonly string[]> =>
    Option.flatMap(Option.liftPredicate(only, isFailedResult), (failed) => Option.fromNullishOr(failed.reproduce))

  const sameArgv = (actual: readonly string[], expected: readonly string[]): boolean =>
    actual.length === expected.length && expected.every((value, index) => actual[index] === value)

  const positionsEqual = (
    location: NonNullable<FailedTestResultEncoded['location']>,
    line: number,
    column: number,
  ): boolean => location.line === line && location.column === column

  const locatedAt = (only: TestResultEncoded, file: string, line: number, column: number): boolean =>
    Option.exists(
      locationOfFailure(only),
      (location) => location.file === file && positionsEqual(location, line, column),
    )

  const keptStackWithoutLocation = (only: TestResultEncoded, stack: string): boolean =>
    Option.exists(
      Option.liftPredicate(only, isFailedResult),
      (failed) => failed.stack === stack && failed.location === undefined,
    )

  const hasFailureMessage = (only: TestResultEncoded): boolean => 'failureMessage' in only

  const hasOptionalEvidence = (only: TestResultEncoded): boolean => 'location' in only || 'stack' in only

  const unfailedShapeIsBare = (only: TestResultEncoded): boolean =>
    !hasFailureMessage(only) && !hasOptionalEvidence(only)

  const hasWidenedFailureShape = (only: TestResultEncoded): boolean =>
    Boolean.match(isFailedResult(only), {
      onTrue: () => hasFailureMessage(only),
      onFalse: () => unfailedShapeIsBare(only),
    })

  it.prop(
    '∀r_TestRecord_≡FullTestNameOrSuitePath',
    { of: [Records.VitestTestRecord, S.String], subject: interpretVitestTestRun },
    (subject, [record, projectRoot]) => {
      const [only] = subject(singleRecordRun(record, projectRoot))
      const composed = [...record.suiteNames, record.name].join(' > ').trim()
      return only.name === Option.getOrElse(Option.fromNullishOr(record.fullTestName), () => composed)
    },
  )

  it.prop(
    '∀r_TestRecord_≡SkippedIffSkipModeOrState',
    { of: [Records.VitestTestRecord, S.String], subject: interpretVitestTestRun },
    (subject, [record, projectRoot]) => {
      const [only] = subject(singleRecordRun(record, projectRoot))
      return (only.status === 'skipped') === (isSkippedMode(record.mode) || isSkippedMode(record.state))
    },
  )

  it.prop(
    '∀r_TestRecord_≡WidenedFailureShape',
    { of: [Records.VitestTestRecord, S.String], subject: interpretVitestTestRun },
    (subject, [record, projectRoot]) => {
      const [only] = subject(singleRecordRun(record, projectRoot))
      return hasWidenedFailureShape(only)
    },
  )

  it.prop(
    '∀r_TestRecord_≡TimeSpentIsDurationOrZero',
    { of: [Records.VitestTestRecord, S.String], subject: interpretVitestTestRun },
    (subject, [record, projectRoot]) => {
      const [only] = subject(singleRecordRun(record, projectRoot))
      return only.timeSpentMs === Option.getOrElse(Option.fromNullishOr(record.durationMs), () => 0)
    },
  )

  it.prop(
    '∀f_FileFailure_≡FailedWithTheStatedMessage',
    { of: [Records.VitestFileFailure, S.String], subject: interpretVitestTestRun },
    (subject, [failure, projectRoot]) => {
      const [only] = subject({ projectRoot, records: [], fileFailures: [failure] })
      return only.status === 'failed' && only.failureMessage === failure.message
    },
  )

  const FileStem = S.String.check(S.isPattern(/^[a-z]{1,8}$/))

  it.prop(
    '∀f_FileFailure_≡NamedAfterTheProjectRelativeFile',
    { of: [FileStem], subject: interpretVitestTestRun },
    (subject, [stem]) => {
      const [only] = subject({
        projectRoot: '/project',
        records: [],
        fileFailures: [{ fileName: `/project/tests/${stem}.spec.ts`, message: 'load failed' }],
      })
      return only.name === `tests/${stem}.spec.ts` && only.id === `tests/${stem}.spec.ts#tests/${stem}.spec.ts`
    },
  )

  it.prop(
    '∀f_FileFailure_≡ReproduceRunsTheFile',
    { of: [FileStem], subject: interpretVitestTestRun },
    (subject, [stem]) => {
      const [only] = subject({
        projectRoot: '/project',
        records: [],
        fileFailures: [{ fileName: `/project/tests/${stem}.spec.ts`, message: 'load failed' }],
      })
      return Option.exists(reproduceOf(only), (argv) => sameArgv(argv, ['vitest', 'run', `tests/${stem}.spec.ts`]))
    },
  )

  const SourceOrdinal = S.Int.check(S.isGreaterThanOrEqualTo(1))

  const failingRecord = (overrides: Partial<VitestTestRecord>): VitestTestRecord => ({
    name: 'fails',
    suiteNames: [],
    ...overrides,
  })

  const TestName = S.String.check(S.isPattern(/^[a-z][a-z ]{0,11}$/))

  it.prop(
    '∀r_FailedTest_≡ReproduceNamesFileAndTest',
    { of: [TestName, FileStem], subject: interpretVitestTestRun },
    (subject, [name, stem]) => {
      const file = `tests/${stem}.spec.ts`
      const record = failingRecord({ name, fullTestName: name, fileName: `/project/${file}` })
      const [only] = subject(singleRecordRun(record, '/project'))
      const expected = Boolean.match(name === file, {
        onTrue: (): readonly string[] => ['vitest', 'run', file],
        onFalse: (): readonly string[] => ['vitest', 'run', file, '-t', name],
      })
      return Option.exists(reproduceOf(only), (argv) => sameArgv(argv, expected))
    },
  )

  it.prop(
    '∀r_ProjectFrame_≡LocatedThere',
    { of: [SourceOrdinal, SourceOrdinal], subject: interpretVitestTestRun },
    (subject, [line, column]) => {
      const record = failingRecord({
        fileName: 'src/a.ts',
        errorMessage: 'boom',
        errorStack: 'Error: boom',
        errorFrames: [
          { file: '/project/node_modules/vitest/dist/runner.js', line: 1, column: 1 },
          { file: '/project/src/a.ts', line, column },
        ],
      })
      const [only] = subject(singleRecordRun(record, '/project'))
      return locatedAt(only, 'src/a.ts', line, column)
    },
  )

  it.prop(
    '∀r_NonProjectFrames_≡StackKeptWithoutLocation',
    { of: [S.String, SourceOrdinal], subject: interpretVitestTestRun },
    (subject, [stack, line]) => {
      const record = failingRecord({
        errorMessage: 'boom',
        errorStack: stack,
        errorFrames: [
          { file: 'node:internal/timers', line, column: line },
          { file: '/project/node_modules/x/y.js', line, column: line },
        ],
      })
      const [only] = subject(singleRecordRun(record, '/project'))
      return keptStackWithoutLocation(only, stack)
    },
  )

  it.prop(
    '∀f_ProjectFrame_≡LocatedThere',
    { of: [SourceOrdinal, SourceOrdinal], subject: interpretVitestTestRun },
    (subject, [line, column]) => {
      const [only] = subject({
        projectRoot: '/project',
        records: [],
        fileFailures: [{
          fileName: 'tests/a.spec.ts',
          message: 'load failed',
          stack: 'SyntaxError: bad',
          frames: [
            { file: '/project/node_modules/vite/dist/x.js', line: 4, column: 2 },
            { file: '/project/tests/a.spec.ts', line, column },
          ],
        }],
      })
      return locatedAt(only, 'tests/a.spec.ts', line, column)
    },
  )
}
