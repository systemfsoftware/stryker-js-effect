import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { type Checker, Options, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Trace } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as TestClock from 'effect/testing/TestClock'
import * as NetAddress from 'effect/unstable/net/NetAddress'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as RpcServer from 'effect/unstable/rpc/RpcServer'
import * as Socket from 'effect/unstable/socket/Socket'
import * as SocketServer from 'effect/unstable/socket/SocketServer'
import { expect, vi } from 'vitest'

import {
  check as checkCompiler,
  groups as groupsCompiler,
  init as initCompiler,
  make as makeTSCompiler,
} from '../src/ts-compiler.handle.js'
import type { TSCompiler } from '../src/ts-compiler.handle.js'

interface TsApiControl {
  sourceFileNames: readonly string[]
  semanticDiagnostics: () => Promise<readonly unknown[]>
  onSemanticDiagnostics?: (() => void) | undefined
}

const tsApi = vi.hoisted((): TsApiControl => ({
  sourceFileNames: [],
  semanticDiagnostics: () => Promise.resolve([]),
  onSemanticDiagnostics: undefined,
}))

vi.mock('typescript/unstable/async', () => {
  const sourceFile = {
    statements: [],
    referencedFiles: [],
    typeReferenceDirectives: [],
  }
  class FakeProgram {
    getSourceFileNames = (): Promise<readonly string[]> => Promise.resolve(tsApi.sourceFileNames)
    getSourceFile = (_fileName: string): Promise<unknown> => Promise.resolve(sourceFile)
    getConfigFileParsingDiagnostics = (): Promise<readonly unknown[]> => Promise.resolve([])
    getSemanticDiagnostics = (): Promise<readonly unknown[]> => {
      tsApi.onSemanticDiagnostics?.()
      return tsApi.semanticDiagnostics()
    }
    getProgramDiagnostics = (): Promise<readonly unknown[]> => Promise.resolve([])
  }
  const program = new FakeProgram()
  const project = { program }
  class FakeSnapshot {
    getProjects = (): unknown[] => [project]
    dispose = (): Promise<void> => Promise.resolve()
  }
  class FakeAPI {
    updateSnapshot = (): Promise<unknown> => Promise.resolve(new FakeSnapshot())
    close = (): Promise<void> => Promise.resolve()
  }
  return {
    API: FakeAPI,
    DiagnosticCategory: { Message: 3, Suggestion: 2, Warning: 0, Error: 1 },
  }
})

const Feature = makeFeature({ it, layer })

const PATIENCE_WINDOW = '11 seconds'
const ORPHAN_GUARD = '30 seconds'

const asBytes = (frame: Uint8Array | string): Uint8Array =>
  Match.value(frame).pipe(
    Match.when(Predicate.isString, (text) => new TextEncoder().encode(text)),
    Match.orElse((bytes) => bytes),
  )

const memorySocket = (inbox: Queue.Queue<Uint8Array>, outbox: Queue.Queue<Uint8Array>): Socket.Socket =>
  Socket.make({
    reader: Effect.succeed({
      pull: Queue.take(inbox).pipe(Effect.map((chunk) => [chunk] as const)),
      upgrade: Socket.SocketUpgradeError.unsupported,
    }),
    writer: Effect.succeed({
      write: (chunk) =>
        Socket.isCloseEvent(chunk)
          ? Effect.void
          : Queue.offer(outbox, asBytes(chunk)).pipe(Effect.asVoid),
      writeAll: (chunks) => Effect.forEach(chunks, (chunk) => Queue.offer(outbox, asBytes(chunk))).pipe(Effect.asVoid),
    }),
  })

const memorySocketPair: Effect.Effect<readonly [Socket.Socket, Socket.Socket]> = Effect.gen(function*() {
  const hostToWorker = yield* Queue.unbounded<Uint8Array>()
  const workerToHost = yield* Queue.unbounded<Uint8Array>()
  return [memorySocket(workerToHost, hostToWorker), memorySocket(hostToWorker, workerToHost)] as const
})

const singleConnection = (socket: Socket.Socket): SocketServer.SocketServer['Service'] => ({
  address: NetAddress.unixPathAddress('busy-checker'),
  run: (handler) => handler(socket).pipe(Effect.orDie, Effect.andThen(Effect.never)),
})

type CheckerRpcsUnion = typeof Plugin.CheckerRpcs extends RpcGroup.RpcGroup<infer Rpcs> ? Rpcs : never

interface HeldCheckHarness {
  readonly client: RpcClient.RpcClient<CheckerRpcsUnion, RpcClientError>
  readonly finishCheck: () => void
  readonly reachedTypeCheck: Promise<void>
  readonly mutant: Checker.CheckerMutantWire
}

const checkerServer = (socket: Socket.Socket, tsconfigFile: string): Layer.Layer<never> =>
  RpcServer.layer(Plugin.CheckerRpcs).pipe(
    Layer.provide(
      Plugin.CheckerRpcs.toLayer(
        Effect.gen(function*() {
          const host = yield* FileSystem.FileSystem
          const pathService = yield* Path.Path
          const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({ tsconfigFile }).pipe(Effect.orDie)
          const compiler: TSCompiler = makeTSCompiler(options, { host, pathService })
          yield* initCompiler(compiler).pipe(Effect.orDie)
          const passed = (mutants: readonly Checker.CheckerMutantWire[]) =>
            Object.fromEntries(mutants.map((mutant) => [mutant.id, { status: 'passed' as const }]))
          return {
            check: ({ mutants }: { readonly mutants: readonly Checker.CheckerMutantWire[] }) =>
              checkCompiler(compiler, mutants).pipe(Effect.orDie, Effect.map(() => passed(mutants))),
            group: ({ mutants }: { readonly mutants: readonly Checker.CheckerMutantWire[] }) =>
              groupsCompiler(compiler, mutants, false).pipe(Effect.orDie),
          }
        }),
      ),
    ),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(Layer.succeed(Socket.Socket, socket)),
    Layer.provide(Layer.succeed(SocketServer.SocketServer, singleConnection(socket))),
    Layer.provide(Trace.layerTraceContextServer),
    Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
  )

interface HeldTypeCheck {
  readonly finish: () => void
  readonly reached: Promise<void>
}

const armHeldTypeCheck = (control: TsApiControl): HeldTypeCheck => {
  const finish = Deferred.makeUnsafe<void, never>()
  const reached = Deferred.makeUnsafe<void, never>()
  control.semanticDiagnostics = (): Promise<readonly unknown[]> =>
    Effect.runPromise(Deferred.await(finish)).then(() => [])
  control.onSemanticDiagnostics = () => Effect.runSync(Deferred.succeed(reached, void 0))
  return {
    finish: () => Effect.runSync(Deferred.succeed(finish, void 0)),
    reached: Deferred.await(reached).pipe(Effect.runPromise),
  }
}
const writeProject = (
  host: FileSystem.FileSystem,
  pathService: Path.Path,
): Effect.Effect<string, FileSystem.PlatformError, Scope.Scope> =>
  Effect.gen(function*() {
    const directory = yield* host.makeTempDirectoryScoped({ prefix: 'checker-responsive-' })
    yield* host.writeFileString(pathService.join(directory, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}')
    yield* host.makeDirectory(pathService.join(directory, 'src'))
    yield* host.writeFileString(pathService.join(directory, 'src', 'a.ts'), 'export const a = 1\n')
    return directory
  })

const mutantIn = (fileName: string): Checker.CheckerMutantWire => ({
  id: Mutant.MutantId.make('mutant-1'),
  fileName: Mutant.CanonicalFileName.make(fileName),
  mutatorName: Mutant.MutatorName.make('ArithmeticOperator'),
  replacement: '2',
  location: { start: { line: 1, column: 17 }, end: { line: 1, column: 18 } },
})

const makeHarness = Effect.gen(function*() {
  const host = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const directory = yield* writeProject(host, pathService)
  tsApi.sourceFileNames = [pathService.join(directory, 'src', 'a.ts')]

  const [clientSocket, serverSocket] = yield* memorySocketPair
  yield* Layer.build(checkerServer(serverSocket, pathService.join(directory, 'tsconfig.json')))

  const held = armHeldTypeCheck(tsApi)
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Layer.succeed(Socket.Socket, clientSocket)),
      Layer.provide(RpcSerialization.layerNdjson),
    ),
  )
  const traceContext = yield* Layer.build(Trace.layerTraceContextClient)
  const client = yield* RpcClient.make(Plugin.CheckerRpcs).pipe(
    Effect.provideContext(Context.merge(protocol, traceContext)),
  )

  return {
    client,
    finishCheck: held.finish,
    reachedTypeCheck: held.reached,
    mutant: mutantIn(pathService.join(directory, 'src', 'a.ts')),
  } satisfies HeldCheckHarness
})

Feature('Keeping the checker connection alive through a long type check')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A check that outlasts the connection patience window is answered, and the connection stays usable',
      Gherkin.Do.pipe(
        Given('a type checker busy with a check that has already outlasted the connection patience window')(
          'held',
          () =>
            Effect.gen(function*() {
              const harness = yield* Effect.provide(makeHarness, Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
              const outcome = yield* Effect.forkChild(
                harness.client
                  .check({ checkerName: 'typescript', mutants: [harness.mutant] })
                  .pipe(Effect.timeout(ORPHAN_GUARD)),
              )
              yield* Effect.promise(() => harness.reachedTypeCheck)
              yield* TestClock.adjust(PATIENCE_WINDOW)
              return { harness, outcome }
            }),
        ),
        When('the long check finishes')('answer', (s) =>
          Effect.gen(function*() {
            s.held.harness.finishCheck()
            yield* TestClock.adjust(ORPHAN_GUARD)
            return yield* Fiber.join(s.held.outcome)
          })),
        Then('the waiting request is answered and the connection is still usable')((s) =>
          Effect.gen(function*() {
            expect(s.answer['mutant-1']?.status).toBe('passed')
            const second = yield* s.held.harness.client
              .check({ checkerName: 'typescript', mutants: [s.held.harness.mutant] })
              .pipe(Effect.timeout(ORPHAN_GUARD))
            expect(second['mutant-1']?.status).toBe('passed')
          })
        ),
      ),
    )
  })
