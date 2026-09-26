import { RunEvent } from '@systemfsoftware/stryker-js'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { it } from '@systemfsoftware/vitest'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import * as S from 'effect/Schema'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { bddStep, prepareFixture } from './__fixtures__/microvm-harness.js'

const FIXTURE_URL = new URL('../testResources/typescript-checker-fixture', import.meta.url)
const TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['verdict', 'error', 'help']
const REQUIRED_EVENT_KINDS: ReadonlyArray<string> = ['stream', 'phase', 'plan', 'mutant', 'verdict']
const RUN_EVENT_KINDS: ReadonlyArray<string> = [
  'stream',
  'phase',
  'plan',
  'mutant',
  'plugins',
  'formats',
  'skipped',
  'tick',
  'verdict',
  'error',
  'help',
]

const parseEventStream = (stdout: string): ReadonlyArray<RunEvent.RunEvent> =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => S.decodeUnknownSync(RunEvent.RunEventWireLine)(line))

const lastEvent = (events: ReadonlyArray<RunEvent.RunEvent>): RunEvent.RunEvent => {
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
    .filter((event): event is Extract<RunEvent.RunEvent, { _tag: 'mutant' }> => event._tag === 'mutant')
    .map((mutant) => `${mutant.mutator}:${mutant.status}`)

const runIdsIn = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<string> =>
  events
    .map((event) => ('runId' in event && typeof event.runId === 'string' ? event.runId : undefined))
    .filter((runId): runId is string => runId !== undefined)

const statusSuffixCount = (mutants: ReadonlyArray<string>, suffix: string): number =>
  mutants.filter((mutant) => mutant.endsWith(suffix)).length

const verifyProcessAndStreamIntegrity = (
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

const verifyVerdictCounts = (expect: Expect, verdict: RunEvent.VerdictReached): Check =>
  expect({
    compileErrors: verdict.counts.compileErrors,
    pending: verdict.counts.pending,
    runtimeErrors: verdict.counts.runtimeErrors,
  }).toStrictEqual({ compileErrors: 4, pending: 0, runtimeErrors: 0 })

const verifyMutantStreamAndActionables = (
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

const verifyBrokenCheckerError = (
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

const verifyDiskReport = (expect: Expect, run: ExecResult, reportText: string): Check => {
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

const verifyDiskStream = (
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

const verifyPresetMutants = (
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

it.live('the in-memory vm runner exits on a verdict with compile errors and killed mutants', function*({ expect }) {
  const fixture = yield* bddStep(
    'Given',
    'an in-memory vm runner fixture installed in the container',
    prepareFixture(FIXTURE_URL, 'typescript-checker-vm-fixture'),
  )
  const run = yield* bddStep(
    'When',
    'Stryker CLI runs with stryker.vm.config.ts',
    Effect.promise(() => fixture.run(['run', 'stryker.vm.config.ts'])),
  )
  const events = parseEventStream(run.stdout)
  const terminal = lastEvent(events)
  if (terminal._tag !== 'verdict') {
    throw new Error(`Expected verdict event, received: ${terminal._tag}`)
  }

  yield* bddStep(
    'Then',
    'the process protocol and stream invariants hold',
    verifyProcessAndStreamIntegrity(expect, run, events),
  )
  yield* bddStep('And', 'the verdict carries the oracle counts', verifyVerdictCounts(expect, terminal))
  yield* bddStep(
    'And',
    'the mutant stream matches the oracle and every event carries one run id',
    verifyMutantStreamAndActionables(expect, events, terminal),
  )
})

it.live(
  'failing checker emits structured StageError carrying the diagnostic cause, not an empty crash',
  function*({ expect }) {
    const fixture = yield* bddStep(
      'Given',
      'a fixture configured with a non-existent tsconfig path',
      prepareFixture(FIXTURE_URL, 'typescript-checker-broken-fixture'),
    )
    const run = yield* bddStep(
      'When',
      'Stryker CLI runs expecting checker failure',
      Effect.promise(() => fixture.run(['run', 'stryker.broken-checker.config.ts'])),
    )
    const events = parseEventStream(run.stdout)

    yield* bddStep(
      'Then',
      'the run fails with structured error payload without crash',
      verifyBrokenCheckerError(expect, run, events),
    )
  },
)

it.live(
  'persists structured json report artifact on container disk and matches contract',
  function*({ expect }) {
    const fixture = yield* bddStep(
      'Given',
      'a fixture configured with json reporter',
      prepareFixture(FIXTURE_URL, 'typescript-checker-disk-fixture'),
    )
    const run = yield* bddStep(
      'When',
      'the CLI completes the mutation run',
      Effect.promise(() => fixture.run(['run', 'stryker.vm.config.ts'])),
    )
    yield* bddStep(
      'Then',
      'the persisted reports/mutation/mutation.json conforms to the schema',
      Effect.gen(function*() {
        const reportText = yield* Effect.promise(() => fixture.readFile('reports/mutation/mutation.json'))
        return yield* verifyDiskReport(expect, run, reportText)
      }),
    )
  },
)

it.live('persists mutation-stream.jsonl on disk matching stdout events', function*({ expect }) {
  const fixture = yield* bddStep(
    'Given',
    'a fixture configured for progress stream tracking',
    prepareFixture(FIXTURE_URL, 'typescript-checker-stream-fixture'),
  )
  const run = yield* bddStep(
    'When',
    'the CLI finishes executing the test run',
    Effect.promise(() => fixture.run(['run', 'stryker.vm.config.ts'])),
  )
  const stdoutEvents = parseEventStream(run.stdout)

  yield* bddStep(
    'Then',
    'the persisted stream on disk is byte-complete and tags match stdout',
    Effect.gen(function*() {
      const streamFileContent = yield* Effect.promise(() => fixture.readFile('reports/mutation-stream.jsonl'))
      return yield* verifyDiskStream(expect, stdoutEvents, parseEventStream(streamFileContent))
    }),
  )
})

it.live('exercises TypeScript composite project references in build mode', function*({ expect }) {
  const fixture = yield* bddStep(
    'Given',
    'a fixture with composite project references',
    prepareFixture(FIXTURE_URL, 'typescript-checker-references-fixture'),
  )
  const run = yield* bddStep(
    'When',
    'Stryker CLI runs with build-mode project references config',
    Effect.promise(() => fixture.run(['run', 'stryker.references.config.ts'])),
  )
  const events = parseEventStream(run.stdout)
  const terminal = lastEvent(events)
  if (terminal._tag !== 'verdict') {
    throw new Error(`Expected verdict event, received: ${terminal._tag}`)
  }

  yield* bddStep(
    'Then',
    'the process protocol and stream invariants hold',
    verifyProcessAndStreamIntegrity(expect, run, events),
  )
  yield* bddStep('And', 'the verdict carries the oracle counts', verifyVerdictCounts(expect, terminal))
  yield* bddStep(
    'And',
    'the mutant stream matches the oracle and every event carries one run id',
    verifyMutantStreamAndActionables(expect, events, terminal),
  )
})

it.live(
  'reports a mutant that breaks a rule inherited from an extended preset as a compile error',
  function*({ expect }) {
    const fixture = yield* bddStep(
      'Given',
      'a fixture whose project config extends a preset that enables unchecked indexed access',
      prepareFixture(FIXTURE_URL, 'typescript-checker-preset-fixture'),
    )
    const run = yield* bddStep(
      'When',
      'the CLI checks a source whose conditional fallback guards an indexed read',
      Effect.promise(() => fixture.run(['run', 'stryker.preset.config.ts'])),
    )
    const events = parseEventStream(run.stdout)
    const terminal = lastEvent(events)
    if (terminal._tag !== 'verdict') {
      throw new Error(`Expected verdict event, received: ${terminal._tag}`)
    }

    yield* bddStep(
      'Then',
      'the process protocol and stream invariants hold',
      verifyProcessAndStreamIntegrity(expect, run, events),
    )
    yield* bddStep(
      'And',
      'the mutant that drops the fallback is a compile error',
      verifyPresetMutants(expect, events, terminal),
    )
  },
)

it.live(
  'keeps a composite project include list so the dry run passes and its mutants are checked',
  function*({ expect }) {
    const fixture = yield* bddStep(
      'Given',
      'a fixture whose application config lists the files it compiles and references a library that leaves a broken file out of its file list',
      prepareFixture(FIXTURE_URL, 'typescript-checker-preservation-fixture'),
    )
    const run = yield* bddStep(
      'When',
      'the CLI checks the application in project-reference mode',
      Effect.promise(() => fixture.run(['run', 'stryker.preservation.config.ts'])),
    )
    const events = parseEventStream(run.stdout)
    const terminal = lastEvent(events)
    if (terminal._tag !== 'verdict') {
      throw new Error(`Expected verdict event, received: ${terminal._tag}`)
    }

    yield* bddStep(
      'Then',
      'the run reaches a verdict and checks the application mutants',
      verifyProcessAndStreamIntegrity(expect, run, events),
    )
    yield* bddStep('And', 'the verdict carries the oracle counts', verifyVerdictCounts(expect, terminal))
    yield* bddStep(
      'And',
      'the mutant stream matches the oracle and every event carries one run id',
      verifyMutantStreamAndActionables(expect, events, terminal),
    )
  },
)
