import { RunEvent } from '@systemfsoftware/stryker-js'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Check, Expect } from '@systemfsoftware/vitest'
import * as S from 'effect/Schema'
import type { ExecResult } from '../../src/Harness/guest-job.schema.js'

export const FIXTURE_URL = new URL('../../testResources/typescript-checker-fixture', import.meta.url)
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
  'verdict',
  'error',
  'help',
]

export const parseEventStream = (stdout: string): ReadonlyArray<RunEvent.RunEvent> =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => S.decodeUnknownSync(RunEvent.RunEventWireLine)(line))

export const lastEvent = (events: ReadonlyArray<RunEvent.RunEvent>): RunEvent.RunEvent => {
  const event = events.at(-1)
  if (event === undefined) {
    throw new Error('stdout carries no events')
  }
  return event
}

const terminalIndexesIn = (kinds: ReadonlyArray<string>): ReadonlyArray<number> =>
  kinds
    .map((kind, index) => ({ index, kind }))
    .filter((entry) => TERMINAL_RUN_KINDS.includes(entry.kind))
    .map((entry) => entry.index)

const kindsOutsideOf = (
  kinds: ReadonlyArray<string>,
  allowed: ReadonlyArray<string>,
): ReadonlyArray<string> => kinds.filter((kind) => !allowed.includes(kind))

const reportedMutantsOf = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<string> =>
  events
    .filter((event): event is Extract<RunEvent.RunEvent, { _tag: 'mutantTested' }> => event._tag === 'mutantTested')
    .map((mutant) => `${mutant.mutatorName}:${mutant.status}`)

const runIdsIn = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<string> =>
  events
    .map((event) => ('runId' in event && typeof event.runId === 'string' ? String(event.runId) : undefined))
    .filter((runId): runId is string => runId !== undefined)

const statusSuffixCount = (mutants: ReadonlyArray<string>, suffix: string): number =>
  mutants.filter((mutant) => mutant.endsWith(suffix)).length

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

export const verifyVerdictCounts = (expect: Expect, verdict: RunEvent.VerdictReached): Check =>
  expect({
    compileErrors: verdict.counts.compileErrors,
    pending: verdict.counts.pending,
    runtimeErrors: verdict.counts.runtimeErrors,
  }).toStrictEqual({ compileErrors: 4, pending: 0, runtimeErrors: 0 })

export const verifyMutantStreamAndActionables = (
  expect: Expect,
  events: ReadonlyArray<RunEvent.RunEvent>,
  verdict: RunEvent.VerdictReached,
): Check => {
  const reportedMutants = reportedMutantsOf(events)
  const actionable = verdict.mutants.map((mutant) => `${mutant.mutator}:${mutant.status}`)
  const runIds = runIdsIn(events)

  return expect({
    reportedCount: reportedMutants.length,
    compileErrorCount: statusSuffixCount(reportedMutants, ':CompileError'),
    killedCount: statusSuffixCount(reportedMutants, ':Killed'),
    survivedCount: statusSuffixCount(reportedMutants, ':Survived'),
    hasStringLiteralCompileError: reportedMutants.includes('StringLiteral:CompileError'),
    actionableCount: actionable.length,
    actionableSurvivorCount: actionable.filter((mutant) => mutant.endsWith(':Survived')).length,
    distinctRunIds: new Set(runIds).size,
    verdictRunIdMatchesFirst: verdict.runId === runIds[0],
  }).toStrictEqual({
    reportedCount: 7,
    compileErrorCount: 4,
    killedCount: 2,
    survivedCount: 1,
    hasStringLiteralCompileError: true,
    actionableCount: 1,
    actionableSurvivorCount: 1,
    distinctRunIds: 1,
    verdictRunIdMatchesFirst: true,
  })
}

export const verifyBrokenCheckerError = (
  expect: Expect,
  run: ExecResult,
  events: ReadonlyArray<RunEvent.RunEvent>,
): Check => {
  const kinds = events.map((event) => event._tag)
  const terminal = lastEvent(events)
  const errorDocument: RunEvent.RunFailed | undefined = terminal._tag === 'error' ? terminal : undefined

  return expect({
    exitCodeIsZero: run.exitCode === 0,
    lastKind: kinds.at(-1),
    carriesVerdict: kinds.includes('verdict'),
    terminalTag: terminal._tag,
    errorNamesTsconfig: (errorDocument?.error ?? '').includes('non-existent-tsconfig.json'),
  }).toStrictEqual({
    exitCodeIsZero: false,
    lastKind: 'error',
    carriesVerdict: false,
    terminalTag: 'error',
    errorNamesTsconfig: true,
  })
}

export const verifyDiskReport = (expect: Expect, run: ExecResult, reportText: string): Check => {
  const report = S.decodeUnknownSync(S.fromJsonString(Report.MutationTestResultSchema))(reportText)
  const fileEntry = report.files['src/order.ts']

  return expect({
    exitCode: run.exitCode,
    schemaVersion: report.schemaVersion,
    fileStatuses: fileEntry === undefined ? undefined : fileEntry.mutants.map((mutant) => mutant.status).toSorted(),
  }).toStrictEqual({
    exitCode: 0,
    schemaVersion: '1.0',
    fileStatuses: ['CompileError', 'CompileError', 'CompileError', 'CompileError', 'Killed', 'Killed', 'Survived'],
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

export const verifyPresetMutants = (
  expect: Expect,
  events: ReadonlyArray<RunEvent.RunEvent>,
  verdict: RunEvent.VerdictReached,
): Check => {
  const reportedMutants = reportedMutantsOf(events)

  return expect({
    reportedCount: reportedMutants.length,
    compileErrorCount: statusSuffixCount(reportedMutants, ':CompileError'),
    hasDroppedFallbackError: reportedMutants.includes('LogicalOperator:CompileError'),
    hasKilledStringLiteral: reportedMutants.includes('StringLiteral:Killed'),
    verdictCompileErrors: verdict.counts.compileErrors,
  }).toStrictEqual({
    reportedCount: 3,
    compileErrorCount: 1,
    hasDroppedFallbackError: true,
    hasKilledStringLiteral: true,
    verdictCompileErrors: 1,
  })
}
