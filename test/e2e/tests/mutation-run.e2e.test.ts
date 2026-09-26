import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import {
  decodeStream,
  MachineStreamError,
  reportedMutantsOf,
  runIdsIn,
  verdictEvent,
} from './__fixtures__/machine-stream.fixture.js'

const CALC_FIXTURE_ORACLE = {
  killed: 7,
  survived: 2,
  total: 9,
  mutantStatusTally: {
    'ArithmeticOperator:Killed': 1,
    'ArithmeticOperator:Survived': 1,
    'BlockStatement:Killed': 2,
    'BlockStatement:Survived': 1,
    'ConditionalExpression:Killed': 2,
    'EqualityOperator:Killed': 2,
  },
  actionableStatusTally: {
    'ArithmeticOperator:Survived': 1,
    'BlockStatement:Survived': 1,
  },
} as const

const CALC_FIXTURE_URL = new URL('../testResources/calc-fixture', import.meta.url)
const TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['verdict', 'error', 'help']
const NON_TERMINAL_RUN_KINDS: ReadonlyArray<string> = [
  'stream',
  'phase',
  'plan',
  'mutantTested',
  'tick',
  'plugins',
  'formats',
  'skipped',
]
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[`)
const STDERR_TAIL_CHARS = 3_000

const terminalIndexesIn = (kinds: ReadonlyArray<string>): ReadonlyArray<number> =>
  kinds
    .map((kind, index) => ({ index, kind }))
    .filter((entry) => TERMINAL_RUN_KINDS.includes(entry.kind))
    .map((entry) => entry.index)

const countedSumOf = (counts: RunEvent.VerdictReached['counts']): number =>
  counts.killed + counts.survived + counts.timeout + counts.compileErrors +
  counts.ignored + counts.noCoverage + counts.pending + counts.runtimeErrors

const verifyStreamAndExit = (expect: Expect, run: ExecResult, events: ReadonlyArray<RunEvent.RunEvent>): Check => {
  const kinds = events.map((event) => event._tag)
  const preceding = kinds.slice(0, -1)

  return expect({
    exitCode: run.exitCode,
    terminalIndexes: terminalIndexesIn(kinds),
    lastKind: kinds.at(-1),
    ansiMatch: run.stdout.match(ANSI_ESCAPE),
    precedingIsNonEmpty: preceding.length > 0,
    strayPrecedingKinds: preceding.filter((kind) => !NON_TERMINAL_RUN_KINDS.includes(kind)),
    workerSockMatch: `${run.stdout}\n${run.stderr}`.match(/Could not restrict "[^"]*worker\.sock"/),
  }).toStrictEqual({
    exitCode: 0,
    terminalIndexes: [kinds.length - 1],
    lastKind: 'verdict',
    ansiMatch: null,
    precedingIsNonEmpty: true,
    strayPrecedingKinds: [],
    workerSockMatch: null,
  })
}

const verifyOracleCounts = (expect: Expect, verdict: RunEvent.VerdictReached): Check =>
  expect({
    break: verdict.thresholds.break,
    compileErrors: verdict.counts.compileErrors,
    ignored: verdict.counts.ignored,
    noCoverage: verdict.counts.noCoverage,
    pending: verdict.counts.pending,
    runtimeErrors: verdict.counts.runtimeErrors,
  }).toStrictEqual({
    break: null,
    compileErrors: 0,
    ignored: 0,
    noCoverage: 0,
    pending: 0,
    runtimeErrors: 0,
  })

const verifyReportedAndActionableMutants = (
  expect: Expect,
  reported: ReadonlyArray<string>,
  verdict: RunEvent.VerdictReached,
): Check =>
  expect({
    reportedCount: reported.length,
    talliedCount: countedSumOf(verdict.counts),
  }).toStrictEqual({
    reportedCount: CALC_FIXTURE_ORACLE.total,
    talliedCount: CALC_FIXTURE_ORACLE.total,
  })

const verifyRunIdConsistency = (
  expect: Expect,
  runIds: ReadonlyArray<string>,
  verdict: RunEvent.VerdictReached,
): Check =>
  expect({
    carriesAtLeastTwoRunIds: runIds.length >= 2,
    distinctRunIds: new Set(runIds).size,
    verdictRunIdMatchesFirst: verdict.runId === runIds.at(0),
  }).toStrictEqual({
    carriesAtLeastTwoRunIds: true,
    distinctRunIds: 1,
    verdictRunIdMatchesFirst: true,
  })

const Feature = makeFeature({ it })

Feature('Running one mutation run through the packed CLI')
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM per scenario and runs the packed CLI, exporting host and worker spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'A default machine-mode run reports the calc oracle verdict',
      Gherkin.Do.pipe(
        When('the CLI runs in machine mode with default configuration')(
          'run',
          () => runStryker({ fixture: CALC_FIXTURE_URL, label: 'calc-fixture', args: ['run', '--json'] }),
        ),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        Then('the process protocol and stream invariants hold')((s, expect) =>
          verifyStreamAndExit(expect, s.run.output.result, s.events)
        ),
        When('the terminal verdict of the decoded stream is read')('verdict', (s) =>
          verdictEvent(s.events).pipe(
            Effect.mapError((error) =>
              new MachineStreamError({
                line: error.line,
                detail: `${error.detail}\nstderr tail: ${s.run.output.result.stderr.slice(-STDERR_TAIL_CHARS)}`,
              })
            ),
          )),
        Then('the mutation verdict tallies match the calc oracle')((s, expect) =>
          verifyOracleCounts(expect, s.verdict)
        ),
        When('the reported mutants of the decoded stream are read')(
          'reported',
          (s) => Effect.succeed(reportedMutantsOf(s.events)),
        ),
        Then('every reported mutant is counted in the verdict')((s, expect) =>
          verifyReportedAndActionableMutants(expect, s.reported, s.verdict)
        ),
        When('the run ids carried by the decoded stream are read')('runIds', (s) => Effect.succeed(runIdsIn(s.events))),
        Then('every event carries the verdict run id')((s, expect) =>
          verifyRunIdConsistency(expect, s.runIds, s.verdict)
        ),
      ),
    )
  })
