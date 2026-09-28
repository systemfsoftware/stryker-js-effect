import { NodeSocket } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine, Serve } from '@systemfsoftware/stryker-js'
import * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Sink from 'effect/Sink'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'
import * as Socket from 'effect/unstable/socket/Socket'

import {
  ConfigureResult,
  DiscoveredFiles,
  type DiscoveredMutant,
  JsonRpcResponse,
  MutantResultFiles,
  ProgressNotification,
  ReboundAnnounced,
  ReboundExited,
  type ReboundOutcome,
} from './__fixtures__/mutation-server.schema.js'

const Feature = makeFeature({ it })

const TARGET_FILE = 'src/mäth.js'
const TARGET_SOURCE = [
  'export const add = (left, right) => left + right',
  '',
  "export const label = 'héllo'",
  '',
].join('\n')

const BUSY_CODE = -32000
const BUSY_MESSAGE = 'a mutation test is already running'
const LISTENING_PREFIX = 'msp:listening '
const EXPOSURE_MARKER = 'not loopback'
const LINE_WAIT = '60 seconds'
const PROBE_WAIT = '30 seconds'
const LOOPBACK_HOSTS: ReadonlyArray<string> = ['127.0.0.1', '::1', 'localhost']

const CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['${TARGET_FILE}'],
  coverageAnalysis: 'off',
  concurrency: 1,
  checkers: [],
  reporters: [],
  cleanTempDir: 'always',
}
`

const UTF8 = new TextEncoder()
const DECODE = new TextDecoder()
const CONTENT_LENGTH = 'Content-Length: '
const HEADER_END = UTF8.encode('\r\n\r\n')

interface Workspace {
  readonly directory: string
}

interface Wire {
  readonly write: (bytes: Uint8Array) => Effect.Effect<void, never, never>
}

interface FrameSource {
  readonly next: Effect.Effect<string, never, never>
  readonly leftover: Effect.Effect<number, never, never>
}

interface Session {
  readonly send: (id: number, method: string, params: S.Json) => Effect.Effect<void, never, never>
  readonly answer: (id: number) => Effect.Effect<JsonRpcResponse, never, never>
  readonly awaitProgress: Effect.Effect<ProgressNotification, never, never>
  readonly notifications: Effect.Effect<ReadonlyArray<ProgressNotification>, never, never>
  readonly leftover: Effect.Effect<number, never, never>
}

interface Harness {
  readonly stdio: Stdio.Stdio
  readonly input: Queue.Queue<Uint8Array, Cause.Done>
  readonly output: Queue.Queue<string, Cause.Done>
  readonly errors: Queue.Queue<string, Cause.Done>
  readonly stderrText: Ref.Ref<string>
}

interface StdioObserved {
  readonly version: string
  readonly discoveredFiles: ReadonlyArray<string>
  readonly discoveredEveryMutantRan: boolean
  readonly progressIsNative: boolean
  readonly progressStatus: string
  readonly everyResultSurvived: boolean
  readonly busyCode: number
  readonly busyMessage: string
  readonly reDiscoveredFiles: ReadonlyArray<string>
  readonly stdoutLeftoverBytes: number
}

interface SocketObserved {
  readonly loopbackHost: boolean
  readonly warnedOnLoopback: boolean
  readonly chunkedConfigureVersion: string
  readonly reboundAnnounced: boolean
  readonly reboundFailure: string
  readonly reboundSamePort: boolean
  readonly reboundHostLoopback: boolean
}

interface TakenPortObserved {
  readonly takenTimedOut: boolean
  readonly takenFailed: boolean
  readonly takenMentionsPort: boolean
}

interface ExposedObserved {
  readonly warned: boolean
  readonly warningNamesTheAddress: boolean
  readonly announced: boolean
}

const concat = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const joined = new Uint8Array(left.length + right.length)
  joined.set(left)
  joined.set(right, left.length)
  return joined
}

const frameOf = (text: string): Uint8Array =>
  concat(UTF8.encode(`${CONTENT_LENGTH}${UTF8.encode(text).length}\r\n\r\n`), UTF8.encode(text))

const ENCODE_JSON = S.encodeResult(S.fromJsonString(S.Json))

const encodeJson = (message: S.Json): string => Result.getOrThrow(ENCODE_JSON(message))

const messageFrameOf = (message: S.Json): Uint8Array => frameOf(encodeJson(message))

const indexOfBytes = (haystack: Uint8Array, needle: Uint8Array): number => {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false
        break
      }
    }
    if (matched) {
      return start
    }
  }
  return -1
}

const parseFrames = (input: Uint8Array): { readonly frames: ReadonlyArray<string>; readonly rest: Uint8Array } => {
  const frames: Array<string> = []
  let rest = input
  for (;;) {
    const headerEnd = indexOfBytes(rest, HEADER_END)
    if (headerEnd < 0) {
      return { frames, rest }
    }
    const length = /content-length: (\d+)/iu.exec(DECODE.decode(rest.subarray(0, headerEnd)))
    if (length === null) {
      return { frames, rest }
    }
    const bodyStart = headerEnd + HEADER_END.length
    const bodyLength = Number(length[1])
    if (rest.length < bodyStart + bodyLength) {
      return { frames, rest }
    }
    frames.push(DECODE.decode(rest.subarray(bodyStart, bodyStart + bodyLength)))
    rest = rest.subarray(bodyStart + bodyLength)
  }
}

const frameSourceOf = (chunks: Queue.Queue<string, Cause.Done>): Effect.Effect<FrameSource, never, never> =>
  Effect.gen(function*() {
    const buffer = yield* Ref.make<Uint8Array>(new Uint8Array())
    const ready = yield* Ref.make<ReadonlyArray<string>>([])
    const next: Effect.Effect<string, never, never> = Effect.suspend(() =>
      Effect.gen(function*() {
        const pending = yield* Ref.get(ready)
        const first = pending[0]
        if (first !== undefined) {
          yield* Ref.set(ready, pending.slice(1))
          return first
        }
        const arrived = yield* Queue.take(chunks).pipe(Effect.orDie, Effect.timeoutOption(LINE_WAIT))
        const chunk = yield* Option.match(arrived, {
          onNone: () => Effect.die(new Error('no frame arrived before the deadline')),
          onSome: Effect.succeed,
        })
        const parsed = parseFrames(concat(yield* Ref.get(buffer), UTF8.encode(chunk)))
        yield* Ref.set(buffer, parsed.rest)
        yield* Ref.set(ready, parsed.frames)
        return yield* next
      })
    )
    return { next, leftover: Effect.map(Ref.get(buffer), (rest) => rest.length) }
  })

const sessionOf = (wire: Wire, source: FrameSource): Effect.Effect<Session, never, never> =>
  Effect.gen(function*() {
    const observed = yield* Ref.make<ReadonlyArray<ProgressNotification>>([])
    const nextMessage = (): Effect.Effect<S.Json, never, never> =>
      source.next.pipe(
        Effect.flatMap((text) =>
          Option.match(S.decodeOption(S.fromJsonString(S.Json))(text), {
            onNone: nextMessage,
            onSome: Effect.succeed,
          })
        ),
      )
    const answer = (id: number): Effect.Effect<JsonRpcResponse, never, never> =>
      Effect.gen(function*() {
        const message = yield* nextMessage()
        const response = S.decodeUnknownOption(JsonRpcResponse)(message)
        if (Option.isSome(response) && response.value.id === id) {
          return response.value
        }
        const notification = S.decodeUnknownOption(ProgressNotification)(message)
        if (Option.isSome(notification)) {
          yield* Ref.update(observed, (all) => [...all, notification.value])
          return yield* answer(id)
        }
        return yield* Effect.die(new Error(`expected a response for ${id}, saw ${encodeJson(message)}`))
      })
    const awaitProgress: Effect.Effect<ProgressNotification, never, never> = nextMessage().pipe(
      Effect.flatMap((message) =>
        Option.match(S.decodeUnknownOption(ProgressNotification)(message), {
          onNone: () => Effect.die(new Error(`expected a progress notification, saw ${encodeJson(message)}`)),
          onSome: (notification) => Ref.update(observed, (all) => [...all, notification]).pipe(Effect.as(notification)),
        })
      ),
      Effect.timeoutOption(LINE_WAIT),
      Effect.flatMap((timed) =>
        Option.match(timed, {
          onNone: () => Effect.die(new Error('no progress notification arrived before the deadline')),
          onSome: Effect.succeed,
        })
      ),
    )
    return {
      send: (id: number, method: string, params: S.Json) =>
        wire.write(messageFrameOf({ jsonrpc: '2.0', id, method, params })),
      answer,
      awaitProgress,
      notifications: Ref.get(observed),
      leftover: source.leftover,
    }
  })

const makeHarness = (): Effect.Effect<Harness, never, never> =>
  Effect.gen(function*() {
    const input = yield* Queue.unbounded<Uint8Array, Cause.Done>()
    const output = yield* Queue.unbounded<string, Cause.Done>()
    const errors = yield* Queue.unbounded<string, Cause.Done>()
    const stderrText = yield* Ref.make('')
    const text = (chunk: string | Uint8Array): string => (typeof chunk === 'string' ? chunk : DECODE.decode(chunk))
    return {
      input,
      output,
      errors,
      stderrText,
      stdio: Stdio.make({
        args: Effect.succeed([]),
        stdin: Stream.fromQueue(input),
        stdout: () => Sink.forEach((chunk: string | Uint8Array) => Queue.offer(output, text(chunk))),
        stderr: () =>
          Sink.forEach((chunk: string | Uint8Array) =>
            Effect.andThen(Ref.update(stderrText, (seen) => seen + text(chunk)), Queue.offer(errors, text(chunk)))
          ),
      }),
    }
  })

const socketChunksOf = (socket: Socket.Socket): Effect.Effect<Queue.Queue<string, Cause.Done>, never, Scope.Scope> =>
  Effect.gen(function*() {
    const chunks = yield* Queue.unbounded<string, Cause.Done>()
    const pull = yield* Effect.orDie(Socket.readerBytes(socket))
    yield* Effect.forkScoped(
      Effect.gen(function*() {
        for (;;) {
          const batch = yield* pull.pipe(Effect.orElseSucceed((): ReadonlyArray<Uint8Array> => []))
          if (batch.length === 0) {
            yield* Queue.end(chunks)
            return
          }
          yield* Effect.forEach(batch, (bytes) => Queue.offer(chunks, DECODE.decode(bytes)), { discard: true })
        }
      }),
    )
    return chunks
  })

const writerOf = (socket: Socket.Socket): Effect.Effect<Wire, never, Scope.Scope> =>
  Effect.map(socket.writer, (writer): Wire => ({ write: (bytes) => Effect.orDie(writer.writeAll([bytes])) }))

const awaitLine = (
  errors: Queue.Queue<string, Cause.Done>,
  matches: (line: string) => boolean,
  deadline: number,
): Effect.Effect<string, never, never> =>
  Effect.gen(function*() {
    const arrived = yield* Queue.take(errors).pipe(Effect.orDie, Effect.timeoutOption('30 seconds'))
    const chunk = yield* Option.match(arrived, {
      onNone: () => Effect.die(new Error('no stderr line arrived before the deadline')),
      onSome: Effect.succeed,
    })
    const found = chunk.split('\n').find((line) => matches(line))
    if (found !== undefined) {
      return found
    }
    const now = yield* Clock.currentTimeMillis
    if (now > deadline) {
      return yield* Effect.die(new Error(`no line matched before the deadline, saw: ${chunk}`))
    }
    return yield* awaitLine(errors, matches, deadline)
  })

const deadlineIn = (millis: number): Effect.Effect<number, never, never> =>
  Effect.map(Clock.currentTimeMillis, (now) => now + millis)

const announcedAddressOf = (line: string): { readonly host: string; readonly port: number } => {
  const address = line.slice(LISTENING_PREFIX.length).trim()
  const separator = address.lastIndexOf(':')
  const separatorIndex = separator < 0 ? address.length : separator
  return {
    host: address.slice(0, separatorIndex).replace(/^\[|\]$/gu, ''),
    port: Number(address.slice(separatorIndex + 1)),
  }
}

const decodedFilesOf = (response: JsonRpcResponse | undefined): DiscoveredFiles =>
  Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(response), (value) => S.decodeUnknownOption(DiscoveredFiles)(value.result)),
    () => ({ files: {} }),
  )

const decodedResultsOf = (response: JsonRpcResponse | undefined): MutantResultFiles =>
  Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(response), (value) => S.decodeUnknownOption(MutantResultFiles)(value.result)),
    () => ({ files: {} }),
  )

const versionOf = (response: JsonRpcResponse | undefined): string =>
  Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(response), (value) => S.decodeUnknownOption(ConfigureResult)(value.result)),
    () => ({ version: 'none' }),
  ).version

const idsOf = (files: DiscoveredFiles): ReadonlyArray<string> =>
  Object.values(files.files).flatMap((file) => file.mutants.map((mutant) => mutant.id)).sort()

const mutantsOf = (
  files: DiscoveredFiles,
): Record<string, { readonly mutants: ReadonlyArray<DiscoveredMutant> }> =>
  Object.fromEntries(
    Object.entries(files.files).map(([fileName, file]) => [fileName, { mutants: [...file.mutants] }]),
  )

const reportedIdsOf = (files: MutantResultFiles): ReadonlyArray<string> =>
  Object.values(files.files).flatMap((file) => file.mutants.map((mutant) => mutant.id)).sort()

const everyResultSurvived = (files: MutantResultFiles): boolean =>
  Object.values(files.files).flatMap((file) => file.mutants).every((mutant) => mutant.status === 'Survived')

const everyProgressIsNative = (notifications: ReadonlyArray<ProgressNotification>): boolean =>
  notifications.length > 0 &&
  notifications.every((notification) => Object.keys(notification.params.files).length > 0)

const writeWorkspace = (): Effect.Effect<Workspace, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-msp-' }))
    yield* fs.writeFileString(path.join(directory, 'package.json'), '{ "name": "msp-consumer", "type": "module" }\n')
    yield* fs.writeFileString(path.join(directory, 'stryker.config.mjs'), CONFIG)
    yield* fs.makeDirectory(path.join(directory, 'src'), { recursive: true })
    yield* fs.writeFileString(path.join(directory, TARGET_FILE), TARGET_SOURCE)
    return { directory }
  }).pipe(Effect.orDie, Effect.provide(Engine.nodePlatformLayer))

const removeWorkspace = (directory: string): Effect.Effect<void, never, never> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })).pipe(
    Effect.orDie,
    Effect.provide(Engine.nodePlatformLayer),
  )

const withDirectory = <A, E, R>(directory: string, use: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.acquireUseRelease(
      Effect.sync(() => globalThis.process.cwd()),
      () =>
        Effect.sync(() => {
          globalThis.process.chdir(directory)
        }).pipe(Effect.andThen(use)),
      (previous) =>
        Effect.sync(() => {
          globalThis.process.chdir(previous)
        }),
    ),
  )

const stdioSessionObserved = (): Effect.Effect<StdioObserved, never, Engine.EnginePorts> =>
  Effect.scoped(Effect.gen(function*() {
    const harness = yield* makeHarness()
    const server = yield* Serve.serveMutationServer({ channel: 'stdio' }).pipe(
      Effect.provideService(Stdio.Stdio, harness.stdio),
      Effect.scoped,
      Effect.forkScoped,
    )
    const session = yield* sessionOf(
      { write: (bytes) => Queue.offer(harness.input, bytes).pipe(Effect.asVoid) },
      yield* frameSourceOf(harness.output),
    )

    yield* session.send(1, 'configure', {})
    const configured = yield* session.answer(1)
    yield* session.send(2, 'discover', { files: [{ path: TARGET_FILE }] })
    const discovered = decodedFilesOf(yield* session.answer(2))
    yield* session.send(3, 'mutationTest', { mutants: mutantsOf(discovered) })
    const progress = yield* session.awaitProgress
    yield* session.send(4, 'mutationTest', { files: [{ path: TARGET_FILE }] })
    const busy = yield* session.answer(4)
    const tested = decodedResultsOf(yield* session.answer(3))
    yield* session.send(5, 'discover', { files: [{ path: TARGET_FILE }] })
    const again = decodedFilesOf(yield* session.answer(5))
    const notifications = yield* session.notifications
    const leftover = yield* session.leftover
    yield* Queue.end(harness.input)
    yield* Fiber.interrupt(server)

    const discoveredIds = idsOf(discovered)
    return {
      version: versionOf(configured),
      discoveredFiles: Object.keys(discovered.files).sort(),
      discoveredEveryMutantRan: discoveredIds.length > 0 &&
        discoveredIds.join(',') === reportedIdsOf(tested).join(','),
      progressIsNative: everyProgressIsNative(notifications),
      progressStatus: Object.values(progress.params.files).flatMap((file) => file.mutants)[0]?.status ?? 'none',
      everyResultSurvived: everyResultSurvived(tested),
      busyCode: busy.error?.code ?? 0,
      busyMessage: busy.error?.message ?? 'none',
      reDiscoveredFiles: Object.keys(again.files).sort(),
      stdoutLeftoverBytes: leftover,
    }
  }))

const socketSessionObserved = (): Effect.Effect<SocketObserved, never, Engine.EnginePorts> =>
  Effect.scoped(Effect.gen(function*() {
    const harness = yield* makeHarness()
    const server = yield* Serve.serveMutationServer({ channel: 'socket', port: 0 }).pipe(
      Effect.provideService(Stdio.Stdio, harness.stdio),
      Effect.scoped,
      Effect.forkScoped,
    )
    const announced = yield* awaitLine(
      harness.errors,
      (line) => line.startsWith(LISTENING_PREFIX),
      yield* deadlineIn(30_000),
    )
    const { host, port } = announcedAddressOf(announced)
    const chunkedConfigureVersion = yield* Effect.scoped(Effect.gen(function*() {
      const socket = yield* NodeSocket.makeNet({ host, port })
      const wire = yield* writerOf(socket)
      const session = yield* sessionOf(wire, yield* frameSourceOf(yield* socketChunksOf(socket)))
      const frame = messageFrameOf({ jsonrpc: '2.0', id: 1, method: 'configure', params: {} })
      yield* wire.write(frame.subarray(0, 12))
      yield* wire.write(frame.subarray(12))
      return versionOf(yield* session.answer(1))
    }))
    const loopbackStderr = yield* Ref.get(harness.stderrText)
    yield* Fiber.interrupt(server)

    const reboundHarness = yield* makeHarness()
    const rebound = yield* Serve.serveMutationServer({ channel: 'socket', port }).pipe(
      Effect.provideService(Stdio.Stdio, reboundHarness.stdio),
      Effect.scoped,
      Effect.exit,
      Effect.forkScoped,
    )
    const reboundOutcome = yield* Effect.race(
      awaitLine(reboundHarness.errors, (line) => line.startsWith(LISTENING_PREFIX), yield* deadlineIn(30_000)).pipe(
        Effect.map((line): ReboundOutcome => ReboundAnnounced.make({ line })),
      ),
      Effect.map(Fiber.join(rebound), (exit): ReboundOutcome => ReboundExited.make({ exit })),
    )
    const reboundAddress = Match.value(reboundOutcome).pipe(
      Match.tag('announced', (again) => announcedAddressOf(again.line)),
      Match.tag('exited', () => undefined),
      Match.exhaustive,
    )
    yield* Fiber.interrupt(rebound)

    return {
      loopbackHost: LOOPBACK_HOSTS.includes(host),
      warnedOnLoopback: loopbackStderr.includes(EXPOSURE_MARKER),
      chunkedConfigureVersion,
      reboundAnnounced: Match.value(reboundOutcome).pipe(
        Match.tag('announced', () => true),
        Match.tag('exited', () => false),
        Match.exhaustive,
      ),
      reboundFailure: Match.value(reboundOutcome).pipe(
        Match.tag('announced', () => 'none'),
        Match.tag('exited', (exited) => Exit.isFailure(exited.exit) ? String(exited.exit.cause) : 'none'),
        Match.exhaustive,
      ),
      reboundSamePort: reboundAddress?.port === port,
      reboundHostLoopback: reboundAddress !== undefined && LOOPBACK_HOSTS.includes(reboundAddress.host),
    }
  }))

const takenPortObserved = (): Effect.Effect<TakenPortObserved, never, Engine.EnginePorts> =>
  Effect.scoped(Effect.gen(function*() {
    const harness = yield* makeHarness()
    const server = yield* Serve.serveMutationServer({ channel: 'socket', port: 0 }).pipe(
      Effect.provideService(Stdio.Stdio, harness.stdio),
      Effect.scoped,
      Effect.forkScoped,
    )
    const announced = yield* awaitLine(
      harness.errors,
      (line) => line.startsWith(LISTENING_PREFIX),
      yield* deadlineIn(30_000),
    )
    const { host, port } = announcedAddressOf(announced)

    const probeHarness = yield* makeHarness()
    const taken = yield* Serve.serveMutationServer({ channel: 'socket', port, address: host }).pipe(
      Effect.provideService(Stdio.Stdio, probeHarness.stdio),
      Effect.scoped,
      Effect.result,
      Effect.timeoutOption(PROBE_WAIT),
    )
    yield* Fiber.interrupt(server)

    return {
      takenTimedOut: Option.isNone(taken),
      takenFailed: Option.match(taken, {
        onNone: () => false,
        onSome: (result) => Result.isFailure(result),
      }),
      takenMentionsPort: Option.match(taken, {
        onNone: () => false,
        onSome: (result) => Result.isFailure(result) && String(result.failure).includes(`:${port}`),
      }),
    }
  }))

const exposedAddressObserved = (): Effect.Effect<ExposedObserved, never, Engine.EnginePorts> =>
  Effect.scoped(Effect.gen(function*() {
    const harness = yield* makeHarness()
    const server = yield* Serve.serveMutationServer({ channel: 'socket', port: 0, address: '0.0.0.0' }).pipe(
      Effect.provideService(Stdio.Stdio, harness.stdio),
      Effect.scoped,
      Effect.forkScoped,
    )
    yield* awaitLine(harness.errors, (line) => line.startsWith(LISTENING_PREFIX), yield* deadlineIn(30_000))
    const stderr = yield* Ref.get(harness.stderrText)
    yield* Fiber.interrupt(server)
    return {
      warned: stderr.includes(EXPOSURE_MARKER),
      warningNamesTheAddress: stderr.includes('0.0.0.0'),
      announced: stderr.includes(LISTENING_PREFIX),
    }
  }))

Feature('Serving the Mutation Server Protocol over stdio and sockets', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the mutation server drives the engine for a client that speaks the protocol')
  .body(({ scenario }) => {
    scenario(
      'A client configures, discovers and mutation-tests, and a concurrent run is refused',
      Gherkin.Do.pipe(
        Given('a consumer project whose test command kills nothing')('workspace', () => writeWorkspace()),
        When('a client speaks framed JSON-RPC over stdio against the engine in process')(
          'observed',
          (s: { readonly workspace: Workspace }) =>
            withDirectory(s.workspace.directory, stdioSessionObserved()).pipe(
              Effect.ensuring(removeWorkspace(s.workspace.directory)),
            ),
        ),
        Then('every request is answered from the engine, one run at a time, and stdout holds only frames')(
          (s: { readonly observed: StdioObserved }, expect) =>
            expect({
              version: s.observed.version,
              discoveredFiles: s.observed.discoveredFiles,
              discoveredEveryMutantRan: s.observed.discoveredEveryMutantRan,
              progressIsNative: s.observed.progressIsNative,
              progressStatus: s.observed.progressStatus,
              everyResultSurvived: s.observed.everyResultSurvived,
              busyCode: s.observed.busyCode,
              busyMessage: s.observed.busyMessage,
              reDiscoveredFiles: s.observed.reDiscoveredFiles,
              stdoutLeftoverBytes: s.observed.stdoutLeftoverBytes,
            }).toEqual({
              version: '0.4.0',
              discoveredFiles: [TARGET_FILE],
              discoveredEveryMutantRan: true,
              progressIsNative: true,
              progressStatus: 'Survived',
              everyResultSurvived: true,
              busyCode: BUSY_CODE,
              busyMessage: BUSY_MESSAGE,
              reDiscoveredFiles: [TARGET_FILE],
              stdoutLeftoverBytes: 0,
            }),
        ),
      ),
    )

    scenario(
      'A socket client gets a loopback listener, split request frames and an immediate rebind',
      Gherkin.Do.pipe(
        When('a socket client drives the server on an ephemeral port')('observed', () => socketSessionObserved()),
        Then('the default listener is loopback, a split frame is framed back, and the port rebinds')(
          (s: { readonly observed: SocketObserved }, expect) =>
            expect({
              loopbackHost: s.observed.loopbackHost,
              warnedOnLoopback: s.observed.warnedOnLoopback,
              chunkedConfigureVersion: s.observed.chunkedConfigureVersion,
              reboundAnnounced: s.observed.reboundAnnounced,
              reboundFailure: s.observed.reboundFailure,
              reboundSamePort: s.observed.reboundSamePort,
              reboundHostLoopback: s.observed.reboundHostLoopback,
            }).toEqual({
              loopbackHost: true,
              warnedOnLoopback: false,
              chunkedConfigureVersion: '0.4.0',
              reboundAnnounced: true,
              reboundFailure: 'none',
              reboundSamePort: true,
              reboundHostLoopback: true,
            }),
        ),
      ),
    )

    scenario(
      'A port another listener holds fails instead of hanging',
      Gherkin.Do.pipe(
        When('a second server asks for the port the first listener holds')('observed', () => takenPortObserved()),
        Then('the bind fails with a named error rather than blocking')(
          (s: { readonly observed: TakenPortObserved }, expect) =>
            expect({
              takenTimedOut: s.observed.takenTimedOut,
              takenFailed: s.observed.takenFailed,
              takenMentionsPort: s.observed.takenMentionsPort,
            }).toEqual({ takenTimedOut: false, takenFailed: true, takenMentionsPort: true }),
        ),
      ),
    )

    scenario(
      'Binding a non-loopback address warns before the listener is announced',
      Gherkin.Do.pipe(
        When('the server is asked to listen on every interface')('observed', () => exposedAddressObserved()),
        Then('the exposure is named on stderr and the listener is announced')(
          (s: { readonly observed: ExposedObserved }, expect) =>
            expect({
              warned: s.observed.warned,
              warningNamesTheAddress: s.observed.warningNamesTheAddress,
              announced: s.observed.announced,
            }).toEqual({ warned: true, warningNamesTheAddress: true, announced: true }),
        ),
      ),
    )
  })
