/**
 * The Mutation Server Protocol server: stdio and socket transports, one run at
 * a time.
 *
 * Each decoded request runs the same engine the CLI runs, restricted by the
 * `mutate` ranges or mutant ids the request named. The socket transport binds
 * loopback unless an explicit `--address` names another interface: the protocol
 * has no authentication and `mutationTest` executes the project's own test
 * code.
 *
 * Only framed JSON-RPC reaches stdout. Engine logging goes to stderr and the
 * protocol run disables reporters, because a reporter would otherwise write
 * human text onto the stream the client is parsing.
 */
import { NodeSocketServer } from '@effect/platform-node'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { HtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import type { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FiberSet from 'effect/FiberSet'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Socket from 'effect/socket/Socket'
import * as SocketServer from 'effect/socket/SocketServer'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

import { concurrencyCell } from '../concurrency.cell.js'
import type { ConfigOverlay } from '../config/stryker-config.schema.js'
import { stage } from '../drivers/run-stage.js'
import type { ResolvedMode } from '../output-mode.schema.js'
import { readProjectCell } from '../read-project.cell.js'
import { generateRunId } from '../reporting/verdict-envelope.js'
import { instrumentCell } from '../run/instrument.cell.js'
import { loadConfigCell } from '../run/load-config.cell.js'
import { prepareCell } from '../run/prepare.cell.js'
import { mutationTestCell } from '../run/run-stages.cell.js'
import { type RunEnvironmentShape } from '../run/RunEnvironment.service.js'
import type { EnginePorts, RunStageServices } from '../run/StageServices.service.js'
import { emptyFraming, frameOf, readFrames } from './msp-framing.schema.js'
import { type MspDecision, mspProtocol, MspRequestCommand } from './msp-protocol.workflow.js'
import {
  decodeJsonRpcRequest,
  type DiscoveredFiles,
  type DiscoverResult,
  encodeJsonRpcResponse,
  encodeProgressNotification,
  type JsonRpcId,
  MSP_INTERNAL_ERROR,
  MSP_INVALID_PARAMS,
  MSP_METHOD_NOT_FOUND,
  MSP_METHODS,
  MSP_PARSE_ERROR,
  MSP_PROTOCOL_VERSION,
  MSP_SERVER_BUSY,
  type MspMutantResult,
  type MutationTestParams,
  type MutationTestResult,
  type ReportMutationTestProgress,
  restrictPatternsOf,
  ServeError,
} from './msp.schema.js'

export interface ServeRequest {
  readonly channel: 'stdio' | 'socket'
  readonly port?: number
  readonly address?: string
  readonly cliOptions?: Options.PartialStrykerOptions
  readonly configOverlay: ConfigOverlay
}

interface FailureLike {
  readonly message?: string
}

type ServeOptions = Options.PartialStrykerOptions & { readonly mutantIds?: ReadonlyArray<string> }

const HEADLESS_MODE: ResolvedMode = { mode: 'human', signal: 'flag', stdoutIsTTY: false }

const PROTOCOL_CLI_OPTIONS: Options.PartialStrykerOptions = { logLevel: 'warn', reporters: [] }

const LOOPBACK = 'localhost'

const LOOPBACK_NAMES: ReadonlyArray<string> = [LOOPBACK, '127.0.0.1', '::1', '[::1]']

interface ServerState {
  readonly configFilePath: string | undefined
}

interface Connection {
  readonly chunks: Stream.Stream<Uint8Array>
  readonly write: (payload: string) => Effect.Effect<void, ServeError>
}

interface EngineRun {
  readonly env: RunEnvironmentShape
  readonly context: Context.Context<RunStageServices>
}

const serveEnvironment = (
  basePath: string,
  startedAt: number,
  configOverlay: ConfigOverlay,
): RunEnvironmentShape => ({
  runId: generateRunId(DateTime.makeUnsafe(startedAt)),
  resolvedMode: HEADLESS_MODE,
  runStartedAt: startedAt,
  basePath,
  builtinReporters: { html: HtmlReporter.makeHtmlReporter },
  configOverlay,
  allowConsoleColors: false,
})

const describe = (failure: FailureLike, fallback: string): string =>
  Option.getOrElse(
    Option.filter(Option.fromUndefinedOr(failure.message), S.is(S.NonEmptyString)),
    () => fallback,
  )

const optionalFieldsOf = (
  entries: ReadonlyArray<readonly [string, S.Json | undefined]>,
): Readonly<Record<string, S.Json>> =>
  entries.reduce<Record<string, S.Json>>((fields, [key, value]) => {
    if (value !== undefined) {
      fields[key] = value
    }
    return fields
  }, {})

const copiedOrUndefined = (tests: ReadonlyArray<string> | undefined): ReadonlyArray<string> | undefined =>
  Option.getOrUndefined(Option.map(Option.fromUndefinedOr(tests), (present) => [...present]))

const withoutUndefined = <A>(value: A | undefined): A | undefined => value

const bucketOf = <A>(grouped: Map<string, Array<A>>, key: string): Array<A> =>
  Option.getOrElse(
    Option.fromUndefinedOr(grouped.get(key)),
    () => {
      const fresh: Array<A> = []
      grouped.set(key, fresh)
      return fresh
    },
  )

const withEngine = <A, E>(
  configOverlay: ConfigOverlay,
  consume: (event: RunEvent.RunEvent) => Effect.Effect<void, ServeError>,
  use: (run: EngineRun) => Effect.Effect<A, E, EnginePorts>,
): Effect.Effect<A, E | ServeError, EnginePorts> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const basePath = yield* fs.realPath('.').pipe(
      Effect.mapError(() => ServeError.make({ reason: 'cannot resolve the working directory' })),
    )
    const startedAt = yield* Clock.currentTimeMillis
    const env = serveEnvironment(basePath, startedAt, configOverlay)
    const events = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const consumer = yield* Stream.fromQueue(events).pipe(Stream.runForEach(consume), Effect.forkChild)
    const run = Effect.scoped(
      Effect.gen(function*() {
        const context = yield* Layer.build(stage(env, events))
        return yield* use({ env, context })
      }),
    )
    return yield* run.pipe(
      Effect.ensuring(Queue.end(events).pipe(Effect.andThen(Fiber.join(consumer)), Effect.ignore)),
    )
  })

const discoverStageCell = Cell.andThen(
  Cell.andThen(Cell.andThen(loadConfigCell, readProjectCell), prepareCell),
  Cell.andThen(concurrencyCell, instrumentCell),
)

const discoveredFilesOf = (
  mutants: readonly Mutant.Mutant[],
  relativeFileName: (fileName: string) => string,
): DiscoverResult['files'] => {
  const grouped = new Map<string, Array<DiscoverResult['files'][string]['mutants'][number]>>()
  for (const mutant of mutants) {
    bucketOf(grouped, relativeFileName(mutant.fileName)).push({
      id: mutant.id,
      location: mutant.location,
      mutatorName: mutant.mutatorName,
      ...optionalFieldsOf([
        ['replacement', mutant.replacement],
        ['description', withoutUndefined(mutant.description)],
      ]),
    })
  }
  return Object.fromEntries([...grouped].map(([fileName, groupedMutants]) => [fileName, { mutants: groupedMutants }]))
}

const reportedMutantOf = (result: Mutant.RunMutantResult): MspMutantResult =>
  Object.assign(
    {
      id: result.id,
      location: result.location,
      mutatorName: result.mutatorName,
      replacement: result.replacement,
      status: result.status,
    },
    optionalFieldsOf([
      ['static', withoutUndefined(result.static)],
      ['coveredBy', copiedOrUndefined(result.coveredBy)],
      ['killedBy', copiedOrUndefined(result.killedBy)],
      ['statusReason', withoutUndefined(result.statusReason)],
      ['testsCompleted', withoutUndefined(result.testsCompleted)],
      ['duration', Option.getOrUndefined(Option.map(Option.fromNullishOr(result.cost), (cost) => cost.testBodyMs))],
    ]),
  )

const mutationTestFilesOf = (
  results: readonly Mutant.RunMutantResult[],
  relativeFileName: (fileName: string) => string,
): MutationTestResult['files'] => {
  const grouped = new Map<string, Array<MspMutantResult>>()
  for (const result of results) {
    bucketOf(grouped, relativeFileName(result.fileName)).push(reportedMutantOf(result))
  }
  return Object.fromEntries([...grouped].map(([fileName, groupedMutants]) => [fileName, { mutants: groupedMutants }]))
}

const progressOf = (tested: RunEvent.RunMutantTested): ReportMutationTestProgress => ({
  jsonrpc: '2.0',
  method: MSP_METHODS.reportMutationTestProgress,
  params: {
    files: {
      [tested.fileName]: {
        mutants: [Object.assign(
          {
            id: tested.id,
            location: tested.location,
            mutatorName: tested.mutatorName,
            status: tested.status,
            static: tested.static,
          },
          optionalFieldsOf([
            ['replacement', withoutUndefined(tested.replacement)],
            [
              'duration',
              Option.getOrUndefined(Option.map(Option.fromNullishOr(tested.cost), (cost) => cost.testBodyMs)),
            ],
            [
              'testsCompleted',
              Option.getOrUndefined(Option.map(Option.fromNullishOr(tested.cost), (cost) => cost.testsExecuted)),
            ],
          ]),
        )],
      },
    },
  },
})

const encodedOr = <E>(encoded: Result.Result<string, E>, what: string): Effect.Effect<string, ServeError> =>
  Result.match(encoded, {
    onFailure: (issue) => ServeError.make({ reason: `cannot encode ${what}`, cause: issue }),
    onSuccess: Effect.succeed,
  })

const optionsOf = (invocation: ServeRequest, configFilePath: string | undefined): ServeOptions =>
  Object.assign(
    { ...invocation.cliOptions, ...PROTOCOL_CLI_OPTIONS },
    optionalFieldsOf([['configFile', withoutUndefined(configFilePath)]]),
  )

const mutantIdsOf = (mutants: DiscoveredFiles): ReadonlyArray<string> =>
  Object.values(mutants).flatMap((file) => file.mutants.map((mutant) => mutant.id))

const withPatterns = (options: ServeOptions, patterns: ReadonlyArray<string> | undefined): ServeOptions =>
  Option.getOrElse(
    Option.map(Option.fromUndefinedOr(patterns), (present) => ({ ...options, mutate: [...present] })),
    () => options,
  )

const mutationTestOptionsOf = (
  invocation: ServeRequest,
  configFilePath: string | undefined,
  params: MutationTestParams,
): ServeOptions =>
  Option.match(Option.fromUndefinedOr(params.mutants), {
    onNone: () => withPatterns(optionsOf(invocation, configFilePath), restrictPatternsOf(params.files)),
    onSome: (mutants) => ({
      ...optionsOf(invocation, configFilePath),
      mutate: Object.keys(mutants),
      mutantIds: mutantIdsOf(mutants),
    }),
  })

const runDiscover = (
  configOverlay: ConfigOverlay,
  options: ServeOptions,
  targetMutatePatterns: ReadonlyArray<string> | undefined,
): Effect.Effect<DiscoverResult, ServeError, EnginePorts> =>
  withEngine(configOverlay, () => Effect.void, ({ env, context }) =>
    Effect.gen(function*() {
      const path = yield* Path.Path
      const done = yield* Cell.provideContext(discoverStageCell, context).run({
        cliOptions: options,
        targetMutatePatterns: targetMutatePatterns === undefined ? undefined : [...targetMutatePatterns],
      })
      return { files: discoveredFilesOf(done.mutants, (fileName) => path.relative(env.basePath, fileName)) }
    }).pipe(
      Effect.mapError((failure) => ServeError.make({ reason: describe(failure, 'discovery failed'), cause: failure })),
    ))

const runMutationTest = (
  configOverlay: ConfigOverlay,
  options: ServeOptions,
  targetMutatePatterns: ReadonlyArray<string> | undefined,
  notify: (tested: RunEvent.RunMutantTested) => Effect.Effect<void, ServeError>,
): Effect.Effect<MutationTestResult, ServeError, EnginePorts> =>
  withEngine(
    configOverlay,
    (event) =>
      Match.value(event).pipe(
        Match.tag('mutantTested', (tested) => notify(tested)),
        Match.orElse(() => Effect.void),
      ),
    ({ env, context }) =>
      Effect.gen(function*() {
        const path = yield* Path.Path
        const done = yield* Cell.provideContext(mutationTestCell, context).run({
          cliOptions: options,
          targetMutatePatterns: targetMutatePatterns === undefined ? undefined : [...targetMutatePatterns],
        })
        return { files: mutationTestFilesOf(done.results, (fileName) => path.relative(env.basePath, fileName)) }
      }).pipe(
        Effect.mapError((failure) =>
          ServeError.make({ reason: describe(failure, 'the mutation test failed'), cause: failure })
        ),
      ),
  )

const respond = (connection: Connection, id: JsonRpcId, result: S.Json): Effect.Effect<void, ServeError> =>
  Effect.flatMap(
    encodedOr(encodeJsonRpcResponse({ jsonrpc: '2.0' as const, id, result }), 'a response'),
    (payload) => connection.write(payload),
  )

const respondError = (
  connection: Connection,
  id: JsonRpcId | null,
  code: number,
  message: string,
): Effect.Effect<void, ServeError> =>
  Effect.flatMap(
    encodedOr(encodeJsonRpcResponse({ jsonrpc: '2.0' as const, id, error: { code, message } }), 'an error response'),
    (payload) => connection.write(payload),
  )

const notifyProgress = (
  connection: Connection,
  notification: ReportMutationTestProgress,
): Effect.Effect<void, ServeError> =>
  Effect.flatMap(
    encodedOr(encodeProgressNotification(notification), 'a progress notification'),
    (payload) => connection.write(payload),
  )

const runRequested = (
  decision: MspDecision,
  connection: Connection,
  stateRef: Ref.Ref<ServerState>,
  invocation: ServeRequest,
): Effect.Effect<void, ServeError, EnginePorts> => {
  const state = Effect.map(Ref.get(stateRef), (current) => current.configFilePath)
  return Match.value(decision).pipe(
    Match.tag(
      'MspConfigureRequested',
      ({ id, configFilePath }) =>
        Effect.andThen(
          Ref.set(stateRef, { configFilePath }),
          respond(connection, id, { version: MSP_PROTOCOL_VERSION }),
        ),
    ),
    Match.tag('MspDiscoverRequested', ({ id, params }) =>
      Effect.gen(function*() {
        const result = yield* Effect.result(
          runDiscover(invocation.configOverlay, optionsOf(invocation, yield* state), restrictPatternsOf(params.files)),
        )
        yield* Result.match(result, {
          onFailure: (failure) => respondError(connection, id, MSP_INTERNAL_ERROR, failure.reason),
          onSuccess: (files) => respond(connection, id, files),
        })
      })),
    Match.tag('MspMutationTestRequested', ({ id, params }) =>
      Effect.gen(function*() {
        const result = yield* Effect.result(
          runMutationTest(
            invocation.configOverlay,
            mutationTestOptionsOf(invocation, yield* state, params),
            undefined,
            (tested) => notifyProgress(connection, progressOf(tested)),
          ),
        )
        yield* Result.match(result, {
          onFailure: (failure) => respondError(connection, id, MSP_INTERNAL_ERROR, failure.reason),
          onSuccess: (files) => respond(connection, id, files),
        })
      })),
    Match.tag(
      'MspMethodNotFound',
      ({ id, method }) => respondError(connection, id, MSP_METHOD_NOT_FOUND, `unknown method "${method}"`),
    ),
    Match.tag(
      'MspInvalidParams',
      ({ id, method, issue }) =>
        respondError(connection, id, MSP_INVALID_PARAMS, `invalid params for "${method}": ${issue}`),
    ),
    Match.tag(
      'MspRequestBusy',
      ({ id }) => respondError(connection, id, MSP_SERVER_BUSY, 'a mutation test is already running'),
    ),
    Match.tag('MspNotificationIgnored', () => Effect.void),
    Match.exhaustive,
  )
}

const startsRunOf = (decision: MspDecision): boolean =>
  Match.value(decision).pipe(
    Match.tag('MspMutationTestRequested', () => true),
    Match.tag('MspConfigureRequested', () => false),
    Match.tag('MspDiscoverRequested', () => false),
    Match.tag('MspMethodNotFound', () => false),
    Match.tag('MspInvalidParams', () => false),
    Match.tag('MspRequestBusy', () => false),
    Match.tag('MspNotificationIgnored', () => false),
    Match.exhaustive,
  )

const releaseRun = (busy: Ref.Ref<boolean>, startsRun: boolean): Effect.Effect<void> =>
  Match.value(startsRun).pipe(
    Match.when(true, () => Ref.set(busy, false)),
    Match.when(false, () => Effect.void),
    Match.exhaustive,
  )

const dispatchRequest = (
  request: { readonly method: string; readonly params: S.Json | undefined },
  id: JsonRpcId,
  connection: Connection,
  stateRef: Ref.Ref<ServerState>,
  busy: Ref.Ref<boolean>,
  invocation: ServeRequest,
): Effect.Effect<void, ServeError, EnginePorts> =>
  Effect.gen(function*() {
    const running = yield* Ref.get(busy)
    const decision = Result.getOrThrow(
      mspProtocol(MspRequestCommand.make({ id, method: request.method, params: request.params, busy: running })),
    )
    const startsRun = startsRunOf(decision)
    const wasRunning = yield* Ref.modify(busy, (current) => [current, current || startsRun] as const)
    yield* Match.value(wasRunning && startsRun).pipe(
      Match.when(true, () => respondError(connection, id, MSP_SERVER_BUSY, 'a mutation test is already running')),
      Match.when(false, () =>
        runRequested(decision, connection, stateRef, invocation).pipe(
          Effect.ensuring(releaseRun(busy, startsRun)),
        )),
      Match.exhaustive,
    )
  })

const handleFrame = (
  raw: string,
  connection: Connection,
  stateRef: Ref.Ref<ServerState>,
  busy: Ref.Ref<boolean>,
  invocation: ServeRequest,
): Effect.Effect<void, ServeError, EnginePorts> =>
  Result.match(decodeJsonRpcRequest(raw), {
    onFailure: () => respondError(connection, null, MSP_PARSE_ERROR, 'the message is not a JSON-RPC 2.0 request'),
    onSuccess: (request) =>
      Option.match(Option.fromUndefinedOr(request.id), {
        onNone: () => Effect.void,
        onSome: (id) =>
          dispatchRequest(
            { method: request.method, params: request.params },
            id,
            connection,
            stateRef,
            busy,
            invocation,
          ),
      }),
  })

const serveConnection = (
  connection: Connection,
  invocation: ServeRequest,
): Effect.Effect<void, ServeError, EnginePorts | Scope.Scope> =>
  Effect.gen(function*() {
    const stateRef = yield* Ref.make<ServerState>({ configFilePath: undefined })
    const busy = yield* Ref.make(false)
    const decoder = yield* Ref.make(emptyFraming)
    const handlers = yield* FiberSet.make<void, ServeError>()
    yield* connection.chunks.pipe(
      Stream.runForEach((chunk) =>
        Effect.gen(function*() {
          const step = yield* Ref.modify(decoder, (buffer) => {
            const read = readFrames(buffer, chunk)
            return [read, read.buffer] as const
          })
          yield* Effect.forEach(step.errors, (error) => respondError(connection, null, MSP_PARSE_ERROR, error), {
            discard: true,
          })
          yield* Effect.forEach(
            step.frames,
            (frame) => FiberSet.run(handlers, handleFrame(frame, connection, stateRef, busy, invocation)),
            { discard: true },
          )
        })
      ),
    )
    yield* FiberSet.join(handlers)
  })

const stdioConnection = (stdio: Stdio.Stdio): Connection => ({
  chunks: stdio.stdin.pipe(Stream.catch(() => Stream.empty)),
  write: (payload) =>
    Stream.run(Stream.succeed(frameOf(payload)), stdio.stdout({ endOnDone: false })).pipe(
      Effect.mapError(() => ServeError.make({ reason: 'cannot write to standard output' })),
    ),
})

const socketConnection = (socket: Socket.Socket): Effect.Effect<Connection, never, Scope.Scope> =>
  Effect.gen(function*() {
    const writer = yield* socket.writer
    const pull = yield* Socket.readerBytes(socket)
    const connection: Connection = {
      chunks: Stream.fromEffectRepeat(pull).pipe(
        Stream.flatMap((batch) => Stream.fromIterable(batch)),
        Stream.catch(() => Stream.empty),
      ),
      write: (payload) =>
        writer.writeAll([frameOf(payload)]).pipe(
          Effect.mapError(() => ServeError.make({ reason: 'cannot write to the socket' })),
        ),
    }
    return connection
  }).pipe(Effect.orDie)

const writeStderr = (stdio: Stdio.Stdio, line: string): Effect.Effect<void, ServeError> =>
  Stream.run(Stream.succeed(`${line}\n`), stdio.stderr({ endOnDone: false })).pipe(
    Effect.mapError(() => ServeError.make({ reason: 'cannot write to standard error' })),
  )

const exposureWarning = (address: string): string =>
  `MSP socket mode is listening on ${address}, which is not loopback: the mutation server has no authentication and runs this project's test code, so anyone who can reach that interface can drive it.`

const portOf = (invocation: ServeRequest): Effect.Effect<number, ServeError> =>
  Option.match(Option.fromUndefinedOr(invocation.port), {
    onNone: () => ServeError.make({ reason: 'the socket channel needs --port' }),
    onSome: Effect.succeed,
  })

const exposureIfNeeded = (stdio: Stdio.Stdio, address: string): Effect.Effect<void, ServeError> =>
  Match.value(LOOPBACK_NAMES.includes(address)).pipe(
    Match.when(true, () => Effect.void),
    Match.when(false, () => writeStderr(stdio, exposureWarning(address))),
    Match.exhaustive,
  )

const bindListener = (
  address: string,
  port: number,
): Effect.Effect<Context.Context<SocketServer.SocketServer>, ServeError, Scope.Scope> =>
  Layer.build(NodeSocketServer.layer({ port, host: address })).pipe(
    Effect.mapError((failure) =>
      ServeError.make({
        reason: `cannot bind ${address}:${port}: ${describe(failure, 'the listener failed')}`,
        cause: failure,
      })
    ),
  )

const serveStdio = (invocation: ServeRequest): Effect.Effect<void, ServeError, EnginePorts | Scope.Scope> =>
  Effect.flatMap(Stdio.Stdio, (stdio) => serveConnection(stdioConnection(stdio), invocation))

const serveSocket = (invocation: ServeRequest): Effect.Effect<void, ServeError, EnginePorts | Scope.Scope> =>
  Effect.gen(function*() {
    const stdio = yield* Stdio.Stdio
    const address = Option.getOrElse(Option.fromUndefinedOr(invocation.address), () => LOOPBACK)
    const port = yield* portOf(invocation)
    yield* exposureIfNeeded(stdio, address)
    const serverContext = yield* bindListener(address, port)
    const server = Context.get(serverContext, SocketServer.SocketServer)
    yield* writeStderr(stdio, `msp:listening ${String(server.address)}`)
    const connections = yield* FiberSet.make<void, ServeError>()
    return yield* server.run((socket) =>
      FiberSet.run(
        connections,
        Effect.scoped(
          Effect.flatMap(socketConnection(socket), (connection) => serveConnection(connection, invocation)),
        ),
      )
    ).pipe(
      Effect.onInterrupt(() => FiberSet.clear(connections)),
      Effect.ensuring(FiberSet.clear(connections)),
      Effect.mapError((failure) =>
        ServeError.make({ reason: `the listener failed: ${describe(failure, 'unknown cause')}`, cause: failure })
      ),
    )
  })

export const serveMutationServer = (
  invocation: ServeRequest,
): Effect.Effect<void, ServeError, EnginePorts | Scope.Scope> =>
  Match.value(invocation.channel).pipe(
    Match.when('stdio', () => serveStdio(invocation)),
    Match.orElse(() => serveSocket(invocation)),
  )
