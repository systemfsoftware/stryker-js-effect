import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Formatter from 'effect/Formatter'
import * as Layer from 'effect/Layer'
import * as Predicate from 'effect/Predicate'
import * as Option from 'effect/Option'
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

const inspectValue = (value: string | object): string =>
  Match.value(value).pipe(
    Match.when(Predicate.isString, (text) => text),
    Match.orElse((item) => Formatter.format(item)),
  )

interface FormatProgress<A = unknown> {
  readonly args: ReadonlyArray<A>
  readonly cursor: number
  readonly text: string
}

const PLACEHOLDER = /(%[sdijfopO%])/gu
const PLACEHOLDER_PART = /^%[sdijfopO%]$/u

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
  Match.value(progress.cursor < progress.args.length).pipe(
    Match.when(true, () => ({
      args: progress.args,
      cursor: progress.cursor + 1,
      text: progress.text + placeholderText(placeholder, progress.args[progress.cursor]),
    })),
    Match.when(false, () => appendLiteral(progress, placeholder)),
    Match.exhaustive,
  )

const consumePlaceholder = <A>(progress: FormatProgress<A>, placeholder: string): FormatProgress<A> =>
  Match.value(placeholder).pipe(
    Match.when(Match.is('%%'), () => appendLiteral(progress, '%')),
    Match.orElse(() => substitutePlaceholder(progress, placeholder)),
  )

const formatStep = <A>(progress: FormatProgress<A>, part: string): FormatProgress<A> =>
  Match.value(part).pipe(
    Match.when(
      (candidate: string) => PLACEHOLDER_PART.test(candidate),
      (placeholder) => consumePlaceholder(progress, placeholder),
    ),
    Match.orElse((literal) => appendLiteral(progress, literal)),
  )

const formatTemplate = <A = unknown>(template: string, args: ReadonlyArray<A>): string => {
  const parts = template.split(PLACEHOLDER)
  const progress = parts.reduce<FormatProgress<A>>(formatStep, { args, cursor: 0, text: '' })
  const trailing = progress.args
    .slice(progress.cursor)
    .map((argument) => ` ${inspectValue(argument)}`)
  return progress.text + trailing.join('')
}

const formatArgs = <A = unknown>(args: ReadonlyArray<A>): string => {
  const [first, ...rest] = args
  return Match.value(typeof first === 'string').pipe(
    Match.when(true, () => formatTemplate(first, rest)),
    Match.when(false, () => args.map(inspectValue).join(' ')),
    Match.exhaustive,
  )
}

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

const joinChunks = (chunks: ReadonlyArray<string>): string => chunks.join('\n')

const resetBuffers = (buffers: MachineConsoleBuffers): void => {
  buffers.chunks.length = 0
  buffers.counts.clear()
  buffers.timers.clear()
}

const makeCapturingConsole = (clock: Clock.Clock, buffers: MachineConsoleBuffers): Console.Console => ({
  assert: <A = unknown>(condition: boolean, ...args: ReadonlyArray<A>) =>
    Match.value(condition).pipe(
      Match.when(false, () => buffers.chunks.push(`Assertion failed: ${formatArgs(args)}`)),
      Match.when(true, () => undefined),
      Match.exhaustive,
    ),
  clear: () => {},
  count: (label) => {
    const key = consoleLabel(label)
    const next = Option.getOrElse(Option.fromNullishOr(buffers.counts.get(key)), () => 0) + 1
    buffers.counts.set(key, next)
    buffers.chunks.push(`${key}: ${next}`)
  },
  countReset: (label) => buffers.counts.delete(consoleLabel(label)),
  debug: <A = unknown>(...args: ReadonlyArray<A>) => buffers.chunks.push(formatArgs(args)),
  dir: <A = unknown, B = unknown>(item: A, _options?: Record<string, B>) =>
    buffers.chunks.push(Formatter.format(item)),
  dirxml: (item) => buffers.chunks.push(Formatter.format(item)),
  error: <A = unknown>(...args: ReadonlyArray<A>) => buffers.chunks.push(formatArgs(args)),
  group: () => {},
  groupCollapsed: () => {},
  groupEnd: () => {},
  info: <A = unknown>(...args: ReadonlyArray<A>) => buffers.chunks.push(formatArgs(args)),
  log: <A = unknown>(...args: ReadonlyArray<A>) => buffers.chunks.push(formatArgs(args)),
  table: (tabularData) => buffers.chunks.push(Formatter.format(tabularData)),
  time: (label) => buffers.timers.set(consoleLabel(label), clock.monotonicTimeNanosUnsafe()),
  timeEnd: (label) => {
    const key = consoleLabel(label)
    Option.match(Option.fromNullishOr(buffers.timers.get(key)), {
      onSome: (started) => {
        buffers.timers.delete(key)
        buffers.chunks.push(`${key}: ${elapsedMs(started, clock.monotonicTimeNanosUnsafe())}ms`)
      },
      onNone: () => undefined,
    })
  },
  timeLog: (label, ...args) => {
    const key = consoleLabel(label)
    Option.match(Option.fromNullishOr(buffers.timers.get(key)), {
      onNone: () => undefined,
      onSome: (started) => {
        const elapsed = elapsedMs(started, clock.monotonicTimeNanosUnsafe())
        Match.value(args).pipe(
const inspectValue = (value: string | object): string =>
  Match.value(value).pipe(
    Match.when(Predicate.isString, (text) => text),
    Match.orElse((item) => Formatter.format(item)),
  )
          ),
          Match.orElse((values) => buffers.chunks.push(`${key}: ${elapsed}ms ${formatArgs(values)}`)),
        )
      },
    })
  },
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
    read: () => joinChunks(buffers.chunks),
    reset: () => resetBuffers(buffers),
  }
}

export class MachineConsole extends Context.Service<MachineConsole, MachineConsoleShape>()(
  '@systemfsoftware/stryker-js/machine-console.service/MachineConsole',
) {
  static readonly layer: Layer.Layer<MachineConsole> = Layer.effect(
    MachineConsole,
    Clock.clockWith((clock) => Effect.succeed(MachineConsole.of(machineConsoleOf(clock)))),
  )

  static readonly consoleLayer: Layer.Layer<Console.Console, never, MachineConsole> = Layer.effect(
    Console.Console,
    Effect.map(MachineConsole, (machine) => {
      machine.reset()
      return machine.console
    }),
  )
}
