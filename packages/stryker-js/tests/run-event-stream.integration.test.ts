import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js'
import { RunEvent as CliContract } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import * as Sink from 'effect/Sink'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const PLAN_KNOWN = CliContract.PlanKnown.make({ total: 4 })
const PHASE_ENTERED = CliContract.PhaseEntered.make({ phase: 'dry-run', elapsedMs: 1 })
const HEARTBEAT = CliContract.Heartbeat.make({ elapsedMs: 2, completed: 1, total: 4 })
const HELP_RENDERED = CliContract.HelpRendered.make({ schemaVersion: '5.0', code: 0, help: 'usage' })
const RUN_FAILED = CliContract.RunFailed.make({
  schemaVersion: '5.0',
  code: 3,
  error: 'x',
  remediation: 'y',
  reason: null,
})

const pathService = Effect.runSync(Effect.provide(Path.Path, Path.layer))

const VERDICT_RUN_ID = CliContract.RunId.make('00000000000000000000000000')

const MUTANT_LOCATION = { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } }

interface MutantFixture {
  readonly index: number
  readonly static: boolean
  readonly status: 'Survived' | 'Ignored'
  readonly bodyMs: number | null
}

const MIXED_MUTANTS: ReadonlyArray<MutantFixture> = [
  { index: 1, static: true, status: 'Survived', bodyMs: 30 },
  { index: 2, static: true, status: 'Survived', bodyMs: 50 },
  { index: 3, static: false, status: 'Survived', bodyMs: 2 },
  { index: 4, static: false, status: 'Survived', bodyMs: 3 },
]

const IGNORED_STATIC_MUTANTS: ReadonlyArray<MutantFixture> = [
  { index: 1, static: true, status: 'Ignored', bodyMs: null },
  { index: 2, static: true, status: 'Survived', bodyMs: 30 },
  { index: 3, static: false, status: 'Survived', bodyMs: 2 },
]

const mutantIdTextOf = (index: number): string => String(index).padStart(16, '0')

const mutantLineOf = (fixture: MutantFixture): CliContract.RunMutantTestedEvent =>
  CliContract.RunMutantTestedEvent.make({
    id: Mutant.MutantId.make(mutantIdTextOf(fixture.index)),
    status: fixture.status,
    fileName: Mutant.CanonicalFileName.make('src/a.ts'),
    location: MUTANT_LOCATION,
    mutatorName: Mutant.MutatorName.make('ArithmeticOperator'),
    replacement: '+',
    completed: fixture.index,
    total: 4,
    static: fixture.static,
    cost: fixture.bodyMs === null
      ? null
      : CliContract.MutantCost.make({
        fixedOverheadMs: 0,
        testBodyMs: fixture.bodyMs,
        testsExecuted: 1,
        shared: false,
      }),
  })

const reportOf = (fixtures: ReadonlyArray<MutantFixture>): Report.MutationTestResult => ({
  schemaVersion: '1.0',
  thresholds: { high: 100, low: 80 },
  files: {
    'src/a.ts': {
      language: 'typescript',
      source: '',
      mutants: fixtures.map(
        (fixture): Report.MutantResult => ({
          id: mutantIdTextOf(fixture.index),
          mutatorName: 'ArithmeticOperator',
          replacement: '+',
          status: fixture.status,
          location: MUTANT_LOCATION,
          static: fixture.static,
        }),
      ),
    },
  },
})

const runResultOf = (fixture: MutantFixture): Mutant.RunMutantResult => ({
  _tag: 'Mutant',
  id: Mutant.MutantId.make(mutantIdTextOf(fixture.index)),
  fileName: Mutant.CanonicalFileName.make('src/a.ts'),
  mutatorName: Mutant.MutatorName.make('ArithmeticOperator'),
  replacement: '+',
  location: MUTANT_LOCATION,
  status: fixture.status,
  static: fixture.static,
  ...(fixture.bodyMs === null
    ? {}
    : { cost: { fixedOverheadMs: 0, testBodyMs: fixture.bodyMs, testsExecuted: 1, shared: false } }),
})

const costTotalOf = (cost: CliContract.MutantCost | null): number =>
  cost === null ? 0 : cost.fixedOverheadMs + cost.testBodyMs

interface CapturedStream {
  readonly stream: RunEvent.RunEventStream
  readonly stdout: Ref.Ref<ReadonlyArray<string>>
  readonly stderr: Ref.Ref<ReadonlyArray<string>>
}

interface RecordedSinks {
  readonly file: ReadonlyArray<string>
  readonly stdout: ReadonlyArray<string>
}

interface RecordedStream {
  readonly stream: RunEvent.RunEventStream
  readonly recorded: Ref.Ref<RecordedSinks>
}

const EMPTY_SINKS: RecordedSinks = { file: [], stdout: [] }

const chunkText = (chunk: string | Uint8Array): string =>
  typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)

const capturingStdio = (
  stdout: Ref.Ref<ReadonlyArray<string>>,
  stderr: Ref.Ref<ReadonlyArray<string>>,
): Layer.Layer<Stdio.Stdio> =>
  Stdio.layerTest({
    stdout: () =>
      Sink.forEach((chunk: string | Uint8Array) => Ref.update(stdout, (lines) => [...lines, chunkText(chunk)])),
    stderr: () =>
      Sink.forEach((chunk: string | Uint8Array) => Ref.update(stderr, (lines) => [...lines, chunkText(chunk)])),
  })

const capturingFixture = (mode: 'machine' | 'human'): Effect.Effect<CapturedStream, never, never> =>
  Effect.gen(function*() {
    const stdout = yield* Ref.make<ReadonlyArray<string>>([])
    const stderr = yield* Ref.make<ReadonlyArray<string>>([])
    const stdio = capturingStdio(stdout, stderr)
    const stream = yield* RunEvent.makeRunEventStream({ mode, signal: 'tty' }).pipe(
      Effect.provide(Layer.mergeAll(stdio, RunEvent.RunEventDrainLive.pipe(Layer.provide(stdio)))),
    )
    return { stream, stdout, stderr }
  })

const collectorDrain = (recorded: Ref.Ref<RecordedSinks>): Layer.Layer<RunEvent.RunEventDrain> =>
  Layer.succeed(
    RunEvent.RunEventDrain,
    RunEvent.RunEventDrain.of({
      drainFramed: (framed, toStdout) =>
        Stream.runCollect(framed).pipe(
          Effect.map((collected) => Array.from(collected)),
          Effect.flatMap((lines) =>
            Ref.update(recorded, (previous) => ({
              file: [...previous.file, ...lines],
              stdout: toStdout ? [...previous.stdout, ...lines] : previous.stdout,
            }))
          ),
        ),
      setProgressStreamFile: () => Effect.void,
    }),
  )

const recordingFixture = (mode: 'machine' | 'human'): Effect.Effect<RecordedStream, never, never> =>
  Effect.gen(function*() {
    const recorded = yield* Ref.make<RecordedSinks>(EMPTY_SINKS)
    const stream = yield* RunEvent.makeRunEventStream({ mode, signal: 'tty' }).pipe(
      Effect.provide(Layer.merge(Stdio.layerTest({}), collectorDrain(recorded))),
    )
    return { stream, recorded }
  })

const offerAll = (
  stream: RunEvent.RunEventStream,
  events: ReadonlyArray<CliContract.RunEvent>,
): Effect.Effect<void, never, never> =>
  Effect.forEach(events, (event) => Queue.offer(stream.queue, event)).pipe(Effect.asVoid)

const decodedEventAt = (lines: ReadonlyArray<string>, index: number): Option.Option<CliContract.RunEvent> =>
  Option.all(lines.map((line) => S.decodeOption(CliContract.RunEventWireLine)(line))).pipe(
    Option.flatMap((events) => Option.fromNullishOr(events[index])),
  )

const tagOf = (event: CliContract.RunEvent): string => event._tag

const parseLinesAsEvents = (lines: ReadonlyArray<string>): ReadonlyArray<CliContract.RunEvent> => {
  const decoded = Option.all(lines.map((line) => S.decodeOption(CliContract.RunEventWireLine)(line)))
  if (Option.isSome(decoded)) {
    return decoded.value
  }
  throw new Error(`Failed to decode JSONL event stream:\n${lines.join('\n')}`)
}

const stderrLinesOf = (stderr: ReadonlyArray<string>): ReadonlyArray<string> => stderr.map((line) => line.trim())

Feature('Streaming a run to machine readers')
  .withLayer(Layer.empty)
  .live(
    'the stream heartbeat is a real-time Stream.tick at a 10-second interval; a virtual clock would fire it instantly and frame heartbeats the run never emitted',
  )
  .body(({ scenario }) => {
    scenario(
      'A machine run reports its opening header and sequential lifecycle events on stdout, and keeps stderr free of human status lines',
      Gherkin.Do.pipe(
        Given('a run configured to emit machine-readable events to stdout')(
          'fixture',
          () => capturingFixture('machine'),
        ),
        When('the stream opens, receives lifecycle progress events, and closes gracefully')(
          'result',
          (s) =>
            Effect.gen(function*() {
              yield* s.fixture.stream.open
              yield* offerAll(s.fixture.stream, [PLAN_KNOWN, PHASE_ENTERED, HEARTBEAT, HELP_RENDERED])
              yield* s.fixture.stream.closeAndDrain
              return {
                stdout: yield* Ref.get(s.fixture.stdout),
                stderr: yield* Ref.get(s.fixture.stderr),
              }
            }),
        ),
        Then(
          'every stdout line decodes as a wire record in chronological sequence, each newline-terminated, opening with machine session metadata',
        )((s, expect) => {
          const opening = Option.filter(decodedEventAt(s.result.stdout, 0), S.is(CliContract.RunStarted))
          return expect({
            tags: parseLinesAsEvents(s.result.stdout).map(tagOf),
            newlineTerminated: s.result.stdout.every((line) => line.endsWith('\n')),
            stderr: stderrLinesOf(s.result.stderr),
            opening: Option.match(opening, {
              onNone: () => null,
              onSome: (started) => ({
                mode: started.mode,
                signal: started.signal,
                schemaVersion: started.schemaVersion,
                runIdIsNonEmpty: String(started.runId).length > 0,
              }),
            }),
          }).toEqual({
            tags: ['stream', 'plan', 'phase', 'tick', 'help'],
            newlineTerminated: true,
            stderr: [],
            opening: { mode: 'machine', signal: 'tty', schemaVersion: '5.0', runIdIsNonEmpty: true },
          })
        }),
      ),
    )

    scenario(
      'A human run keeps stdout free of the wire and reports its progress as status lines on stderr',
      Gherkin.Do.pipe(
        Given('a run streaming in human mode')('fixture', () => capturingFixture('human')),
        When('the run opens and fails')(
          'result',
          (s) =>
            Effect.gen(function*() {
              yield* s.fixture.stream.open
              yield* offerAll(s.fixture.stream, [PLAN_KNOWN, PHASE_ENTERED, RUN_FAILED])
              yield* s.fixture.stream.closeAndDrain
              const open = yield* s.fixture.stream.isOpen
              return {
                stdout: yield* Ref.get(s.fixture.stdout),
                stderr: yield* Ref.get(s.fixture.stderr),
                open,
              }
            }),
        ),
        Then('the machine reader receives no lines on stdout and the operator receives the status lines')((s, expect) =>
          expect({
            stdout: s.result.stdout,
            stderr: stderrLinesOf(s.result.stderr),
            open: s.result.open,
          }).toEqual({
            stdout: [],
            stderr: ['plan 4 mutants', 'phase dry-run', 'error x'],
            open: false,
          })
        ),
      ),
    )

    scenario(
      'A human run still writes the wire records to the progress stream file that merge-reports rebuilds from',
      Gherkin.Do.pipe(
        Given('a human run whose sinks are recorded')('fixture', () => recordingFixture('human')),
        When('the run opens, reports progress, and closes')(
          'result',
          (s) =>
            Effect.gen(function*() {
              yield* s.fixture.stream.open
              yield* offerAll(s.fixture.stream, [PLAN_KNOWN, PHASE_ENTERED, RUN_FAILED])
              yield* s.fixture.stream.closeAndDrain
              return yield* Ref.get(s.fixture.recorded)
            }),
        ),
        Then('the file sink holds every newline-terminated wire record while the stdout sink stays empty')((
          s,
          expect,
        ) =>
          expect({
            tags: parseLinesAsEvents(s.result.file).map(tagOf),
            newlineTerminated: s.result.file.every((line) => line.endsWith('\n')),
            stdout: s.result.stdout,
          }).toEqual({
            tags: ['plan', 'phase', 'error'],
            newlineTerminated: true,
            stdout: [],
          })
        ),
      ),
    )

    scenario(
      'A machine run mirrors the wire records to stdout as well as the progress stream file',
      Gherkin.Do.pipe(
        Given('a machine run whose sinks are recorded')('fixture', () => recordingFixture('machine')),
        When('the run opens, reports progress, and closes')(
          'result',
          (s) =>
            Effect.gen(function*() {
              yield* s.fixture.stream.open
              yield* offerAll(s.fixture.stream, [PHASE_ENTERED])
              yield* s.fixture.stream.closeAndDrain
              return yield* Ref.get(s.fixture.recorded)
            }),
        ),
        Then('the file sink and the stdout sink received the same wire records')((s, expect) =>
          expect({
            tags: parseLinesAsEvents(s.result.stdout).map(tagOf),
            stdoutMatchesFile: s.result.stdout.join('') === s.result.file.join(''),
          }).toEqual({ tags: ['stream', 'phase'], stdoutMatchesFile: true })
        ),
      ),
    )

    scenario(
      'A terminal failure closes the stream and suppresses subsequent events',
      Gherkin.Do.pipe(
        Given('a run streaming in machine mode')('fixture', () => capturingFixture('machine')),
        When('a fatal error occurs followed by trailing heartbeat ticks before drain')(
          'result',
          (s) =>
            Effect.gen(function*() {
              yield* s.fixture.stream.open
              yield* offerAll(s.fixture.stream, [RUN_FAILED, HEARTBEAT])
              yield* s.fixture.stream.closeAndDrain
              const open = yield* s.fixture.stream.isOpen
              return { stdout: yield* Ref.get(s.fixture.stdout), open }
            }),
        ),
        Then(
          'the consumer receives only the opening header and the error document, which carries the failure code, error message, and remediation guidance, and the stream is permanently closed',
        )((s, expect) => {
          const failure = Option.filter(decodedEventAt(s.result.stdout, 1), S.is(CliContract.RunFailed))
          return expect({
            tags: parseLinesAsEvents(s.result.stdout).map(tagOf),
            failure: Option.match(failure, {
              onNone: () => null,
              onSome: (failed) => ({
                code: failed.code,
                error: failed.error,
                remediation: failed.remediation,
                schemaVersion: failed.schemaVersion,
              }),
            }),
            open: s.result.open,
          }).toEqual({
            tags: ['stream', 'error'],
            failure: { code: 3, error: 'x', remediation: 'y', schemaVersion: '5.0' },
            open: false,
          })
        }),
      ),
    )

    scenario(
      'A broken report sink is reported to the operator and never stops the run',
      Gherkin.Do.pipe(
        Given('a machine run whose report sink always breaks')('fixture', () =>
          Effect.gen(function*() {
            const messages: Array<string> = []
            const capturing = Logger.make((options) => {
              messages.push(String(options.message))
            })
            const stdout = yield* Ref.make<ReadonlyArray<string>>([])
            const failingStdio = Stdio.layerTest({
              stdout: () => Sink.die(new Error('the report sink broke')),
            })
            const stream = yield* RunEvent.makeRunEventStream({ mode: 'machine', signal: 'tty' }).pipe(
              Effect.provide(
                Layer.mergeAll(failingStdio, RunEvent.RunEventDrainLive.pipe(Layer.provide(failingStdio))),
              ),
            )
            return { stream, stdout, messages, logging: Logger.layer([capturing]) }
          })),
        When('the run opens, reports a failure, and closes')(
          'result',
          (s) =>
            Effect.gen(function*() {
              yield* s.fixture.stream.open
              yield* offerAll(s.fixture.stream, [RUN_FAILED])
              yield* s.fixture.stream.closeAndDrain
              return { stdout: yield* Ref.get(s.fixture.stdout), messages: s.fixture.messages }
            }).pipe(Effect.provide(s.fixture.logging)),
        ),
        Then('the stream failure is logged without aborting or crashing the run')((s, expect) =>
          expect({
            drainFailureLogged: s.result.messages.join('\n').includes('stryker.output.drain_failed'),
            stdout: s.result.stdout,
          }).toEqual({ drainFailureLogged: true, stdout: [] })
        ),
      ),
    )

    scenario(
      'The static verdict counts the mutant lines that are static and sums their measured cost totals',
      Gherkin.Do.pipe(
        Given('a machine run streaming two static mutants and two per-test mutants')(
          'fixture',
          () => capturingFixture('machine'),
        ),
        When('the run streams the mutant lines and its verdict, then closes')(
          'result',
          (s) =>
            Effect.gen(function*() {
              const envelope = RunEvent.buildVerdictEnvelope(
                reportOf(MIXED_MUTANTS),
                'machine',
                'flag',
                VERDICT_RUN_ID,
                '/base',
                pathService,
                Option.none(),
                RunEvent.staticVerdictOf(MIXED_MUTANTS.map(runResultOf)),
              )
              yield* s.fixture.stream.open
              yield* offerAll(s.fixture.stream, [
                ...MIXED_MUTANTS.map(mutantLineOf),
                CliContract.VerdictReached.make({
                  schemaVersion: envelope.schemaVersion,
                  runId: envelope.runId,
                  mode: envelope.mode,
                  signal: envelope.signal,
                  score: envelope.score,
                  thresholds: envelope.thresholds,
                  reportFile: envelope.reportFile,
                  counts: envelope.counts,
                  mutants: envelope.mutants,
                  scope: envelope.scope,
                  mutantSetPolicy: envelope.mutantSetPolicy,
                  phaseDurations: envelope.phaseDurations,
                  static: envelope.static,
                }),
              ])
              yield* s.fixture.stream.closeAndDrain
              return { stdout: yield* Ref.get(s.fixture.stdout) }
            }),
        ),
        Then(
          'the decoded static count matches the static mutant lines and the static cost matches their cost totals',
        )((s, expect) => {
          const events = parseLinesAsEvents(s.result.stdout)
          const staticLines = events.filter(S.is(CliContract.RunMutantTested)).filter((line) => line.static)
          const verdict = events.find(S.is(CliContract.VerdictReached))
          return expect({
            staticLineCount: staticLines.length,
            staticLineCostMs: staticLines.reduce((total, line) => total + costTotalOf(line.cost), 0),
            verdictStatic: verdict === undefined ? null : verdict.static,
          }).toEqual({
            staticLineCount: 2,
            staticLineCostMs: 80,
            verdictStatic: { count: 2, costMs: 80 },
          })
        }),
      ),
    )

    scenario(
      'An ignored static mutant still counts as static but contributes no cost to the verdict',
      Gherkin.Do.pipe(
        Given('a machine run with an ignored static mutant, a measured static mutant, and a per-test mutant')(
          'fixture',
          () => capturingFixture('machine'),
        ),
        When('the run streams the mutant lines and its verdict, then closes')(
          'result',
          (s) =>
            Effect.gen(function*() {
              const envelope = RunEvent.buildVerdictEnvelope(
                reportOf(IGNORED_STATIC_MUTANTS),
                'machine',
                'flag',
                VERDICT_RUN_ID,
                '/base',
                pathService,
                Option.none(),
                RunEvent.staticVerdictOf(IGNORED_STATIC_MUTANTS.map(runResultOf)),
              )
              yield* s.fixture.stream.open
              yield* offerAll(s.fixture.stream, [
                ...IGNORED_STATIC_MUTANTS.map(mutantLineOf),
                CliContract.VerdictReached.make({
                  schemaVersion: envelope.schemaVersion,
                  runId: envelope.runId,
                  mode: envelope.mode,
                  signal: envelope.signal,
                  score: envelope.score,
                  thresholds: envelope.thresholds,
                  reportFile: envelope.reportFile,
                  counts: envelope.counts,
                  mutants: envelope.mutants,
                  scope: envelope.scope,
                  mutantSetPolicy: envelope.mutantSetPolicy,
                  phaseDurations: envelope.phaseDurations,
                  static: envelope.static,
                }),
              ])
              yield* s.fixture.stream.closeAndDrain
              return { stdout: yield* Ref.get(s.fixture.stdout) }
            }),
        ),
        Then('the ignored static line is counted but only the measured static cost is summed')((s, expect) => {
          const events = parseLinesAsEvents(s.result.stdout)
          const staticLines = events.filter(S.is(CliContract.RunMutantTested)).filter((line) => line.static)
          const verdict = events.find(S.is(CliContract.VerdictReached))
          return expect({
            staticLineCount: staticLines.length,
            staticLineCostMs: staticLines.reduce((total, line) => total + costTotalOf(line.cost), 0),
            verdictStatic: verdict === undefined ? null : verdict.static,
          }).toEqual({
            staticLineCount: 2,
            staticLineCostMs: 30,
            verdictStatic: { count: 2, costMs: 30 },
          })
        }),
      ),
    )
  })
