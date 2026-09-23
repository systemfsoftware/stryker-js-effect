import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  Heartbeat,
  HelpRendered,
  makeRunEventStream,
  PhaseEntered,
  PlanKnown,
  type RunEvent,
  RunEventDrain,
  RunEventDrainLive,
  type RunEventStream,
  RunEventWireLine,
  RunFailed,
  RunStarted,
} from '@systemfsoftware/stryker-js'
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
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const PLAN_KNOWN = PlanKnown.make({ total: 4 })
const PHASE_ENTERED = PhaseEntered.make({ phase: 'dry-run', elapsedMs: 1 })
const HEARTBEAT = Heartbeat.make({ elapsedMs: 2, completed: 1, total: 4 })
const HELP_RENDERED = HelpRendered.make({ schemaVersion: '1.0', code: 0, help: 'usage' })
const RUN_FAILED = RunFailed.make({ schemaVersion: '1.0', code: 3, error: 'x', remediation: 'y' })

interface StreamFixture {
  readonly stream: RunEventStream
  readonly lines: Ref.Ref<ReadonlyArray<string>>
}

const collectorDrain = (lines: Ref.Ref<ReadonlyArray<string>>): Layer.Layer<RunEventDrain> =>
  Layer.succeed(
    RunEventDrain,
    RunEventDrain.of({
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
    const stream = yield* makeRunEventStream({ mode, signal: 'tty' }).pipe(
      Effect.provide(Layer.merge(Stdio.layerTest({}), collectorDrain(lines))),
    )
    return { stream, lines }
  })

const offerAll = (
  stream: RunEventStream,
  events: ReadonlyArray<RunEvent>,
): Effect.Effect<void, never, never> =>
  Effect.forEach(events, (event) => Queue.offer(stream.queue, event)).pipe(Effect.asVoid)

const rawLinesOf = (fixture: StreamFixture): Effect.Effect<ReadonlyArray<string>> => Ref.get(fixture.lines)

const decodedEventAt = (lines: ReadonlyArray<string>, index: number): Option.Option<RunEvent> =>
  Option.all(lines.map((line) => S.decodeOption(RunEventWireLine)(line))).pipe(
    Option.flatMap((events) => Option.fromNullishOr(events[index])),
  )

const tagOf = (event: RunEvent): string => event._tag

const parseLinesAsEvents = (lines: ReadonlyArray<string>): ReadonlyArray<RunEvent> => {
  const decoded = Option.all(lines.map((line) => S.decodeOption(RunEventWireLine)(line)))
  if (Option.isSome(decoded)) {
    return decoded.value
  }
  throw new Error(`Failed to decode JSONL event stream:\n${lines.join('\n')}`)
}

const expectTags = (lines: ReadonlyArray<string>, expectedTags: ReadonlyArray<string>): void => {
  const events = parseLinesAsEvents(lines)
  expect(events.map(tagOf)).toEqual(expectedTags)
}

Feature('Streaming a run to machine readers')
  .withLayer(Layer.empty)
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
        Then('the consumer receives all framed lines in chronological sequence')((s) => {
          expectTags(s.lines, ['stream', 'plan', 'phase', 'tick', 'help'])
        }),
        Then('every framed line terminates with a newline character')((s) => {
          expect(s.lines.every((line) => line.endsWith('\n'))).toBe(true)
        }),
        Then('the opening event identifies the session with machine mode metadata')((s) => {
          const opening = Option.filter(decodedEventAt(s.lines, 0), S.is(RunStarted))
          expect(Option.isSome(opening)).toBe(true)
          if (Option.isSome(opening)) {
            expect(opening.value.mode).toBe('machine')
            expect(opening.value.signal).toBe('tty')
            expect(opening.value.schemaVersion).toBe('1.0')
            expect(typeof opening.value.runId).toBe('string')
            expect(opening.value.runId.length).toBeGreaterThan(0)
          }
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
        Then('the reader receives no lines and the stream is closed')((s) => {
          expect(s.result.lines).toEqual([])
          expect(s.result.open).toBe(false)
        }),
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
        Then('the consumer receives only the opening header and the error document')((s) => {
          expectTags(s.result.lines, ['stream', 'error'])
        }),
        Then('the error document carries the failure code, error message, and remediation guidance')((s) => {
          const failure = Option.filter(decodedEventAt(s.result.lines, 1), S.is(RunFailed))
          expect(Option.isSome(failure)).toBe(true)
          if (Option.isSome(failure)) {
            expect(failure.value.code).toBe(3)
            expect(failure.value.error).toBe('x')
            expect(failure.value.remediation).toBe('y')
            expect(failure.value.schemaVersion).toBe('1.0')
          }
        }),
        Then('the stream is permanently closed')((s) => {
          expect(s.result.open).toBe(false)
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
            const stream = yield* makeRunEventStream({ mode: 'machine', signal: 'tty' }).pipe(
              Effect.provide(
                Layer.mergeAll(failingStdio, RunEventDrainLive.pipe(Layer.provide(failingStdio))),
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
        Then('the stream failure is logged without aborting or crashing the run')((s) => {
          expect(s.result.messages.join('\n')).toContain('stryker.output.drain_failed')
          expect(s.result.lines).toEqual([])
        }),
      ),
    )
  })
