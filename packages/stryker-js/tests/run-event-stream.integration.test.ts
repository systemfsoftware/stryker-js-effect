import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import * as Sink from 'effect/Sink'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const PLAN_KNOWN = RunEvent.PlanKnown.make({ total: 4 })
const PHASE_ENTERED = RunEvent.PhaseEntered.make({ phase: 'dry-run', elapsedMs: 1 })
const HEARTBEAT = RunEvent.Heartbeat.make({ elapsedMs: 2, completed: 1, total: 4 })
const HELP_RENDERED = RunEvent.HelpRendered.make({ schemaVersion: '1.1', code: 0, help: 'usage' })
const RUN_FAILED = RunEvent.RunFailed.make({
  schemaVersion: '1.1',
  code: 3,
  error: 'x',
  remediation: 'y',
  reason: null,
})

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
  events: ReadonlyArray<RunEvent.RunEvent>,
): Effect.Effect<void, never, never> =>
  Effect.forEach(events, (event) => Queue.offer(stream.queue, event)).pipe(Effect.asVoid)

const decodedEventAt = (lines: ReadonlyArray<string>, index: number): Option.Option<RunEvent.RunEvent> =>
  Option.all(lines.map((line) => S.decodeOption(RunEvent.RunEventWireLine)(line))).pipe(
    Option.flatMap((events) => Option.fromNullishOr(events[index])),
  )

const tagOf = (event: RunEvent.RunEvent): string => event._tag

const parseLinesAsEvents = (lines: ReadonlyArray<string>): ReadonlyArray<RunEvent.RunEvent> => {
  const decoded = Option.all(lines.map((line) => S.decodeOption(RunEvent.RunEventWireLine)(line)))
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
          const opening = Option.filter(decodedEventAt(s.result.stdout, 0), S.is(RunEvent.RunStarted))
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
            opening: { mode: 'machine', signal: 'tty', schemaVersion: '1.1', runIdIsNonEmpty: true },
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
          const failure = Option.filter(decodedEventAt(s.result.stdout, 1), S.is(RunEvent.RunFailed))
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
            failure: { code: 3, error: 'x', remediation: 'y', schemaVersion: '1.1' },
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
  })
