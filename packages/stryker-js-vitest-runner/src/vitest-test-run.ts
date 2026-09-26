/// <reference types="vitest/importMeta" />
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type { VitestFileFailure, VitestTestRecord, VitestTestRun } from './vitest-run-command.schema.js'

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

const testNameOf = (record: VitestTestRecord): string =>
  Option.getOrElse(
    Option.fromNullishOr(record.fullTestName),
    () => [...record.suiteNames, record.name].join(SUITE_SEPARATOR).trim(),
  )

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

const resultOf = (record: VitestTestRecord, projectRoot: string): TestResultEncoded => {
  const base = {
    id: projectRelativeId(`${fileNameOf(record)}#${testNameOf(record)}`, projectRoot),
    name: testNameOf(record),
    timeSpentMs: timeSpentOf(record),
    ...fileNameFieldOf(record),
  }
  return Match.value(testStatusOf(record)).pipe(
    Match.when(
      'failed',
      (): TestResultEncoded => ({ ...base, status: 'failed', failureMessage: failureMessageOf(record) }),
    ),
    Match.when(
      'skipped',
      (): TestResultEncoded =>
        Option.match(Option.fromNullishOr(record.suiteErrorMessage), {
          onNone: (): TestResultEncoded => ({ ...base, status: 'skipped' }),
          onSome: (failureMessage): TestResultEncoded => ({ ...base, status: 'failed', failureMessage }),
        }),
    ),
    Match.orElse((): TestResultEncoded => ({ ...base, status: 'success' })),
  )
}

const fileFailureResultOf = (failure: VitestFileFailure, projectRoot: string): TestResultEncoded => ({
  id: projectRelativeId(`${failure.fileName}#${failure.fileName}`, projectRoot),
  name: failure.fileName,
  timeSpentMs: 0,
  status: 'failed',
  failureMessage: failure.message,
  fileName: failure.fileName,
})

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
    '∀r_TestRecord_≡FailureMessageIffFailed',
    { of: [Records.VitestTestRecord, S.String], subject: interpretVitestTestRun },
    (subject, [record, projectRoot]) => {
      const [only] = subject(singleRecordRun(record, projectRoot))
      return (only.status === 'failed') === ('failureMessage' in only)
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

  it.prop(
    '∀f_FileFailure_≡NamedAfterTheFile',
    { of: [Records.VitestFileFailure, S.String], subject: interpretVitestTestRun },
    (subject, [failure, projectRoot]) => {
      const [only] = subject({ projectRoot, records: [], fileFailures: [failure] })
      return only.name === failure.fileName && only.fileName === failure.fileName
    },
  )
}
