import { FailureRecord, type RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Check, Expect } from '@systemfsoftware/vitest'
import type { ExecResult } from '../../src/Harness/guest-job.schema.js'

export const FIXTURE_URL = new URL('../../testResources/typescript-checker-fixture', import.meta.url)
export const FIXTURE_NAME = 'typescript-checker-fixture'
export const TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['verdict', 'error', 'help']
export const REQUIRED_EVENT_KINDS: ReadonlyArray<string> = ['stream', 'phase', 'plan', 'mutantTested', 'verdict']
export const RUN_EVENT_KINDS: ReadonlyArray<string> = [
  'stream',
  'phase',
  'plan',
  'mutantTested',
  'plugins',
  'formats',
  'skipped',
  'tick',
  'reuse',
  'mutant-detail',
  'feedback',
  'verdict',
  'error',
  'help',
]

const terminalIndexesIn = (kinds: ReadonlyArray<string>): ReadonlyArray<number> =>
  kinds
    .map((kind, index) => ({ index, kind }))
    .filter((entry) => TERMINAL_RUN_KINDS.includes(entry.kind))
    .map((entry) => entry.index)

const kindsOutsideOf = (
  kinds: ReadonlyArray<string>,
  allowed: ReadonlyArray<string>,
): ReadonlyArray<string> => kinds.filter((kind) => !allowed.includes(kind))

export const verifyProcessAndStreamIntegrity = (
  expect: Expect,
  run: ExecResult,
  events: ReadonlyArray<RunEvent.RunEvent>,
): Check => {
  const kinds: ReadonlyArray<string> = events.map((event) => event._tag)

  return expect({
    exitCode: run.exitCode,
    hasEvents: events.length > 0,
    workerSockMatch: run.stdout.match(/Could not restrict "[^"]*worker\.sock"/),
    missingRequiredKinds: REQUIRED_EVENT_KINDS.filter((kind) => !kinds.includes(kind)),
    lastKind: kinds.at(-1),
    carriesError: kinds.includes('error'),
    terminalIndexes: terminalIndexesIn(kinds),
    kindsOutsideKnownSet: kindsOutsideOf(kinds, RUN_EVENT_KINDS),
  }).toStrictEqual({
    exitCode: 0,
    hasEvents: true,
    workerSockMatch: null,
    missingRequiredKinds: [],
    lastKind: 'verdict',
    carriesError: false,
    terminalIndexes: [kinds.length - 1],
    kindsOutsideKnownSet: [],
  })
}

export const verifyRunIds = (
  expect: Expect,
  verdict: RunEvent.VerdictReached,
  runIds: ReadonlyArray<string>,
): Check =>
  expect({
    distinctRunIds: new Set(runIds).size,
    verdictRunIdMatchesFirst: verdict.runId === runIds[0],
  }).toStrictEqual({ distinctRunIds: 1, verdictRunIdMatchesFirst: true })

export interface ReportEnvelope {
  readonly exitCode: number
  readonly schemaVersion: string
}

export const reportEnvelopeOf = (run: ExecResult, report: Report.MutationTestResult): ReportEnvelope => ({
  exitCode: run.exitCode,
  schemaVersion: report.schemaVersion,
})

export const verifyReportEnvelope = (expect: Expect, envelope: ReportEnvelope): Check =>
  expect(envelope).toStrictEqual({ exitCode: 0, schemaVersion: '1.0' })

const BROKEN_CHECKER_EXIT_CODE = 3
const MISSING_TSCONFIG = 'non-existent-tsconfig.json'

export const verifyBrokenCheckerError = (
  expect: Expect,
  run: ExecResult,
  events: ReadonlyArray<RunEvent.RunEvent>,
  terminal: RunEvent.RunEvent,
): Check => {
  const kinds = events.map((event) => event._tag)
  const failure: RunEvent.RunFailed | undefined = terminal._tag === 'error' ? terminal : undefined
  const record: FailureRecord.FailureRecord | undefined = failure?.record

  return expect({
    exitCode: run.exitCode,
    lastKind: kinds.at(-1),
    carriesVerdict: kinds.includes('verdict'),
    terminalTag: terminal._tag,
    schemaVersion: failure?.schemaVersion,
    recordTag: record?._tag,
    checker: record?._tag === 'CheckerFailed' ? record.checker : undefined,
    causeNamesTsconfig: (record?.cause ?? []).some((link) => link.message.includes(MISSING_TSCONFIG)),
  }).toStrictEqual({
    exitCode: BROKEN_CHECKER_EXIT_CODE,
    lastKind: 'error',
    carriesVerdict: false,
    terminalTag: 'error',
    schemaVersion: '3.0',
    recordTag: 'CheckerFailed',
    checker: 'typescript',
    causeNamesTsconfig: true,
  })
}

export const verifyDiskStream = (
  expect: Expect,
  stdoutEvents: ReadonlyArray<RunEvent.RunEvent>,
  diskEvents: ReadonlyArray<RunEvent.RunEvent>,
): Check => {
  const stdoutKinds = stdoutEvents.map((event) => event._tag)
  const diskKinds = diskEvents.map((event) => event._tag)

  return expect({ diskEventCount: diskKinds.length, diskKinds }).toStrictEqual({
    diskEventCount: stdoutKinds.length,
    diskKinds: stdoutKinds,
  })
}
