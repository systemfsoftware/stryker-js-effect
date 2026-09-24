import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Formatter from 'effect/Formatter'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import { CircularJson } from './machine-console.schema.js'

const jsonArgumentText = <A = unknown>(argument: A): string =>
  Result.getOrElse(
    Result.try({
      try: () => String(JSON.stringify(argument)),
      catch: () => CircularJson.make({}),
    }),
    () => '[Circular]',
  )

const inspectValue = <A = unknown>(value: A): string =>
  Option.getOrElse(Option.liftPredicate(value, Predicate.isString), () => Formatter.format(value))

interface FormatProgress<A = unknown> {
  readonly args: ReadonlyArray<A>
  readonly cursor: number
  readonly text: string
}

const PLACEHOLDER = /(%[sdijfopO%])/g
const PLACEHOLDER_PART = /^%[sdijfopO%]$/

const placeholderText = <A = unknown>(placeholder: string, argument: A): string =>
  Match.value(placeholder).pipe(
    Match.when(Match.is('%s'), () => String(argument)),
    Match.when(Match.is('%d', '%i', '%f'), () => Number(argument).toString()),
    Match.when(Match.is('%j'), () => jsonArgumentText(argument)),
    Match.when(Match.is('%o', '%O', '%p'), () => inspectValue(argument)),
    Match.orElse((unmatched) => unmatched),
  )

const appendLiteral = <A>(progress: FormatProgress<A>, literal: string): FormatProgress<A> => ({
  args: progress.args,
  cursor: progress.cursor,
  text: progress.text + literal,
})

const substitutePlaceholder = <A>(progress: FormatProgress<A>, placeholder: string): FormatProgress<A> =>
  Boolean.match(progress.cursor < progress.args.length, {
    onTrue: () => ({
      args: progress.args,
      cursor: progress.cursor + 1,
      text: progress.text + placeholderText(placeholder, progress.args[progress.cursor]),
    }),
    onFalse: () => appendLiteral(progress, placeholder),
  })

const consumePlaceholder = <A>(progress: FormatProgress<A>, placeholder: string): FormatProgress<A> =>
  Match.value(placeholder).pipe(
    Match.when(Match.is('%%'), () => appendLiteral(progress, '%')),
    Match.orElse(() => substitutePlaceholder(progress, placeholder)),
  )

const formatStep = <A>(progress: FormatProgress<A>, part: string): FormatProgress<A> =>
  Match.value(part).pipe(
    Match.when((candidate: string) => PLACEHOLDER_PART.test(candidate), (placeholder) =>
      consumePlaceholder(progress, placeholder)),
    Match.orElse((literal) =>
      appendLiteral(progress, literal)
    ),
  )

const formatTemplate = <A = unknown>(template: string, args: ReadonlyArray<A>): string => {
  const progress = template.split(PLACEHOLDER).reduce<FormatProgress<A>>(formatStep, { args, cursor: 0, text: '' })
  const trailing = progress.args.slice(progress.cursor).map((argument) => ` ${inspectValue(argument)}`)
  return progress.text + trailing.join('')
}

const headOf = <A = unknown>(args: ReadonlyArray<A>) => Option.fromNullishOr(args[0])

const formatArgs = <A = unknown>(args: ReadonlyArray<A>): string =>
  Option.match(
    Option.filter(headOf(args), Predicate.isString),
    {
      onSome: (first) => formatTemplate(first, args.slice(1)),
      onNone: () => args.map(inspectValue).join(' '),
    },
  )

const DEFAULT_CONSOLE_LABEL = 'default'

const consoleLabel = (label: string | undefined): string =>
  Option.getOrElse(Option.fromNullishOr(label), () => DEFAULT_CONSOLE_LABEL)

const elapsedMs = (started: bigint, nowNanos: bigint): number => Number(nowNanos - started) / 1_000_000

interface MachineConsoleBuffers {
  readonly chunks: Array<string>
  readonly counts: Map<string, number>
  readonly timers: Map<string, bigint>
}

const buffersOf = (): MachineConsoleBuffers => ({ chunks: [], counts: new Map(), timers: new Map() })

const nextCount = (buffers: MachineConsoleBuffers, key: string): number =>
  Option.getOrElse(Option.fromNullishOr(buffers.counts.get(key)), () => 0) + 1

const recordCount = (buffers: MachineConsoleBuffers, label: string | undefined): void => {
  const key = consoleLabel(label)
  const next = nextCount(buffers, key)
  buffers.counts.set(key, next)
  buffers.chunks.push(`${key}: ${next}`)
}

const recordTimeEnd = (buffers: MachineConsoleBuffers, label: string | undefined, nowNanos: bigint): void => {
  const key = consoleLabel(label)
  Option.match(Option.fromNullishOr(buffers.timers.get(key)), {
    onNone: () => undefined,
    onSome: (started) => {
      buffers.timers.delete(key)
      buffers.chunks.push(`${key}: ${elapsedMs(started, nowNanos)}ms`)
    },
  })
}

const recordTimeLog = <A = unknown>(
  buffers: MachineConsoleBuffers,
  label: string | undefined,
  args: ReadonlyArray<A>,
  nowNanos: bigint,
): void => {
  const key = consoleLabel(label)
  Option.match(Option.fromNullishOr(buffers.timers.get(key)), {
    onNone: () => undefined,
    onSome: (started) =>
      buffers.chunks.push(
        Boolean.match(args.length === 0, {
          onTrue: () => `${key}: ${elapsedMs(started, nowNanos)}ms`,
          onFalse: () => `${key}: ${elapsedMs(started, nowNanos)}ms ${formatArgs(args)}`,
        }),
      ),
  })
}

const makeCapturingConsole = (clock: Clock.Clock, buffers: MachineConsoleBuffers): Console.Console => ({
  assert: <A = unknown>(condition: boolean, ...args: ReadonlyArray<A>) =>
    Boolean.match(condition, {
      onTrue: () => undefined,
      onFalse: () => buffers.chunks.push(`Assertion failed: ${formatArgs(args)}`),
    }),
  clear: () => {},
  count: (label) => recordCount(buffers, label),
  countReset: (label) => buffers.counts.delete(consoleLabel(label)),
  debug: <A = unknown>(...args: ReadonlyArray<A>) => buffers.chunks.push(formatArgs(args)),
  dir: <A = unknown, B = unknown>(item: A, _options?: Record<string, B>) => buffers.chunks.push(Formatter.format(item)),
  dirxml: (item) => buffers.chunks.push(Formatter.format(item)),
  error: <A = unknown>(...args: ReadonlyArray<A>) => buffers.chunks.push(formatArgs(args)),
  group: () => {},
  groupCollapsed: () => {},
  groupEnd: () => {},
  info: <A = unknown>(...args: ReadonlyArray<A>) => buffers.chunks.push(formatArgs(args)),
  log: <A = unknown>(...args: ReadonlyArray<A>) => buffers.chunks.push(formatArgs(args)),
  table: (tabularData) => buffers.chunks.push(Formatter.format(tabularData)),
  time: (label) => buffers.timers.set(consoleLabel(label), clock.monotonicTimeNanosUnsafe()),
  timeEnd: (label) => recordTimeEnd(buffers, label, clock.monotonicTimeNanosUnsafe()),
  timeLog: (label, ...args) => recordTimeLog(buffers, label, args, clock.monotonicTimeNanosUnsafe()),
  trace: <A = unknown>(...args: ReadonlyArray<A>) =>
    buffers.chunks.push(`Trace: ${formatArgs(args)}\n${new Error().stack ?? ''}`),
  warn: <A = unknown>(...args: ReadonlyArray<A>) => buffers.chunks.push(formatArgs(args)),
})

export interface MachineConsoleShape {
  readonly console: Console.Console
  readonly read: () => string
  readonly reset: () => void
}

const machineConsoleOf = (clock: Clock.Clock): MachineConsoleShape => {
  const buffers = buffersOf()
  return {
    console: makeCapturingConsole(clock, buffers),
    read: () => buffers.chunks.join('\n'),
    reset: () => {
      buffers.chunks.length = 0
      buffers.counts.clear()
      buffers.timers.clear()
    },
  }
}

export class MachineConsole extends Context.Service<MachineConsole, MachineConsoleShape>()(
  '@systemfsoftware/stryker-js/reporting/machine-console.service/MachineConsole',
) {
  static readonly layer: Layer.Layer<MachineConsole> = Layer.effect(
    MachineConsole,
    Clock.clockWith((clock) => Effect.succeed(MachineConsole.of(machineConsoleOf(clock)))),
  )

  static readonly captureLayer: Layer.Layer<never, never, MachineConsole> = Layer.effect(
    Console.Console,
    Effect.map(MachineConsole, (machine) => {
      machine.reset()
      return machine.console
    }),
  )
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const { Schema } = await import('effect')

  it.prop(
    '∀label,n_Count_PrintsOneThroughN',
    [Schema.String, Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 }))],
    ([label, times]) => {
      const machine = machineConsoleOf(Clock.clockWith(Effect.succeed).pipe(Effect.runSync))
      Array.from({ length: times }, () => machine.console.count(label))
      const expected = Array.from({ length: times }, (_, index) => `${label}: ${index + 1}`)
      return machine.read() === expected.join('\n')
    },
  )
}
