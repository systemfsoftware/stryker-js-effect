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

interface StreamFixture {
  readonly stream: RunEvent.RunEventStream
  readonly lines: Ref.Ref<ReadonlyArray<string>>
}

const collectorDrain = (lines: Ref.Ref<ReadonlyArray<string>>): Layer.Layer<RunEvent.RunEventDrain> =>
  Layer.succeed(
    RunEvent.RunEventDrain,
    RunEvent.RunEventDrain.of({
      drainFramed: (framed) =>
        Effect.gen(function*() {
          const collected = yield* Stream.runCollect(framed)
          yield* Ref.set(lines, Array.from(collected))
        }),
      setProgressStreamFile: () => Effect.void,
    }),
  )

const streamingFixture = (mode: 'machine' | 'human'): Effect.Effect<StreamFixture, never, never> =>
  Effect.gen(function*() {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const stream = yield* RunEvent.makeRunEventStream({ mode, signal: 'tty' }).pipe(
      Effect.provide(Layer.merge(Stdio.layerTest({}), collectorDrain(lines))),
    )
    return { stream, lines }
  })

const offerAll = (
  stream: RunEvent.RunEventStream,
  events: ReadonlyArray<RunEvent.RunEvent>,
): Effect.Effect<void, never, never> =>
  Effect.forEach(events, (event) => Queue.offer(stream.queue, event)).pipe(Effect.asVoid)

const rawLinesOf = (fixture: StreamFixture): Effect.Effect<ReadonlyArray<string>> => Ref.get(fixture.lines)

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

Feature('Streaming a run to machine readers')
  .withLayer(Layer.empty)
  .live(
    'the stream heartbeat is a real-time Stream.tick at a 10-second interval; a virtual clock would fire it instantly and frame heartbeats the run never emitted',
  )
  .body(({ scenario }) => {
    scenario(
      'A machine run reports its opening header and sequential lifecycle events ended by newlines',
      Gherkin.Do.pipe(
        Given('a run configured to emit machine-readable events to stdout')(
          'fixture',
          () => streamingFixture('machine'),
        ),
        When('the stream opens, receives lifecycle progress events, and closes gracefully')(
          'lines',
          (s) =>
            Effect.gen(function*() {
              yield* s.fixture.stream.open
              yield* offerAll(s.fixture.stream, [PLAN_KNOWN, PHASE_ENTERED, HEARTBEAT, HELP_RENDERED])
              yield* s.fixture.stream.closeAndDrain
              return yield* rawLinesOf(s.fixture)
            }),
        ),
        Then(
          'the consumer receives all framed lines in chronological sequence, each newline-terminated, opening with machine session metadata',
        )((s, expect) => {
          const opening = Option.filter(decodedEventAt(s.lines, 0), S.is(RunEvent.RunStarted))
          return expect({
            tags: parseLinesAsEvents(s.lines).map(tagOf),
            newlineTerminated: s.lines.every((line) => line.endsWith('\n')),
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
            opening: { mode: 'machine', signal: 'tty', schemaVersion: '1.1', runIdIsNonEmpty: true },
          })
        }),
      ),
    )

    scenario(
      'A human run streams nothing to the machine reader',
      Gherkin.Do.pipe(
        Given('a run streaming in human mode')('fixture', () => streamingFixture('human')),
        When('the run opens and fails')(
          'result',
          (s) =>
            Effect.gen(function*() {
              yield* s.fixture.stream.open
              yield* offerAll(s.fixture.stream, [RUN_FAILED])
              yield* s.fixture.stream.closeAndDrain
              const lines = yield* rawLinesOf(s.fixture)
              const open = yield* s.fixture.stream.isOpen
              return { lines, open }
            }),
        ),
        Then('the reader receives no lines and the stream is closed')((s, expect) =>
          expect({ lines: s.result.lines, open: s.result.open }).toEqual({ lines: [], open: false })
        ),
      ),
    )

    scenario(
      'A terminal failure closes the stream and suppresses subsequent events',
      Gherkin.Do.pipe(
        Given('a run streaming in machine mode')('fixture', () => streamingFixture('machine')),
        When('a fatal error occurs followed by trailing heartbeat ticks before drain')(
          'result',
          (s) =>
            Effect.gen(function*() {
              yield* s.fixture.stream.open
              yield* offerAll(s.fixture.stream, [RUN_FAILED, HEARTBEAT])
              yield* s.fixture.stream.closeAndDrain
              const lines = yield* rawLinesOf(s.fixture)
              const open = yield* s.fixture.stream.isOpen
              return { lines, open }
            }),
        ),
        Then(
          'the consumer receives only the opening header and the error document, which carries the failure code, error message, and remediation guidance, and the stream is permanently closed',
        )((s, expect) => {
          const failure = Option.filter(decodedEventAt(s.result.lines, 1), S.is(RunEvent.RunFailed))
          return expect({
            tags: parseLinesAsEvents(s.result.lines).map(tagOf),
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
            const lines = yield* Ref.make<ReadonlyArray<string>>([])
            const failingStdio = Stdio.layerTest({
              stdout: () => Sink.die(new Error('the report sink broke')),
            })
            const stream = yield* RunEvent.makeRunEventStream({ mode: 'machine', signal: 'tty' }).pipe(
              Effect.provide(
                Layer.mergeAll(failingStdio, RunEvent.RunEventDrainLive.pipe(Layer.provide(failingStdio))),
              ),
            )
            return { stream, lines, messages, logging: Logger.layer([capturing]) }
          })),
        When('the run opens, reports a failure, and closes')(
          'result',
          (s) =>
            Effect.gen(function*() {
              yield* s.fixture.stream.open
              yield* offerAll(s.fixture.stream, [RUN_FAILED])
              yield* s.fixture.stream.closeAndDrain
              const lines = yield* rawLinesOf(s.fixture)
              return { lines, messages: s.fixture.messages }
            }).pipe(Effect.provide(s.fixture.logging)),
        ),
        Then('the stream failure is logged without aborting or crashing the run')((s, expect) =>
          expect({
            drainFailureLogged: s.result.messages.join('\n').includes('stryker.output.drain_failed'),
            lines: s.result.lines,
          }).toEqual({ drainFailureLogged: true, lines: [] })
        ),
      ),
    )
  })
