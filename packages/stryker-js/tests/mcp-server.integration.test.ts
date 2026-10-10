import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

import { Cli } from '@systemfsoftware/stryker-js'
import { Mcp } from '@systemfsoftware/stryker-js-mcp'
import { CallToolResult, JsonRpcResponse, SurvivorList, ToolsListed } from './__fixtures__/mcp-server.schema.js'

const Feature = makeFeature({ it })

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)
const PROTOCOL_VERSION = '2025-06-18'
const TARGET_FILE = 'src/target.ts'
const TARGET_SOURCE = [
  'export const target = (value: number): number => {',
  '  const doubled = value * 2',
  '  return doubled + 1',
  '}',
  '',
].join('\n')

const FEEDBACK_FILE = 'reports/mutation/feedback.jsonl'
const REPORT_FILE = 'reports/mutation/mutation.json'

const CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['${TARGET_FILE}'],
  coverageAnalysis: 'off',
  concurrency: 1,
  checkers: [],
  reporters: ['json'],
  cleanTempDir: 'always',
}
`

const UTF8 = new TextEncoder()

type JsonRpcMessage = typeof JsonRpcResponse.Type
type CallToolEnvelope = typeof CallToolResult.Type

interface Workspace {
  readonly directory: string
}

interface CliRun {
  readonly exitCode: number
  readonly stdout: string
}

interface ToolCall {
  readonly failed: boolean
  readonly structured: S.Json | undefined
  readonly text: string
}

interface Observed {
  readonly runCompleted: boolean
  readonly initialized: boolean
  readonly toolNames: ReadonlyArray<string>
  readonly surfaced: ReadonlyArray<{ readonly id: string; readonly fileName: string; readonly line: number }>
  readonly shown: ToolCall
  readonly rerun: ToolCall
  readonly useful: ToolCall
  readonly unknown: ToolCall
  readonly feedbackLines: ReadonlyArray<string>
  readonly reportListsTheSurfacedId: boolean
}

interface Client {
  readonly initialize: Effect.Effect<JsonRpcMessage, never, never>
  readonly notify: (method: string) => Effect.Effect<void, never, never>
  readonly call: (
    id: number,
    method: string,
    params: Record<string, S.Json>,
  ) => Effect.Effect<JsonRpcMessage, never, never>
}

const writeWorkspace = (): Effect.Effect<Workspace, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-mcp-' }))
    yield* fs.writeFileString(path.join(directory, 'package.json'), '{ "name": "mcp-consumer", "type": "module" }\n')
    yield* fs.writeFileString(path.join(directory, 'stryker.config.mjs'), CONFIG)
    yield* fs.makeDirectory(path.join(directory, 'src'), { recursive: true })
    yield* fs.writeFileString(path.join(directory, TARGET_FILE), TARGET_SOURCE)
    return { directory }
  }).pipe(Effect.orDie, Effect.provide(Cli.platformLayer))

const removeWorkspace = (directory: string): Effect.Effect<void, never, never> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })).pipe(
    Effect.orDie,
    Effect.provide(Cli.platformLayer),
  )

const readText = (directory: string, file: string): Effect.Effect<string, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    return yield* fs.readFileString(path.join(directory, file)).pipe(Effect.orElseSucceed(() => ''))
  }).pipe(Effect.provide(Cli.platformLayer))

const runStryker = (
  root: string,
  args: ReadonlyArray<string>,
): Effect.Effect<CliRun, never, never> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, ...args], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: 'machine', NO_COLOR: '1' },
          extendEnv: true,
        }),
      )
      const printed = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.runDrain))
      const exitCode = yield* handle.exitCode
      const stdout = yield* Fiber.join(printed)
      return { exitCode: Number(exitCode), stdout }
    }),
  ).pipe(Effect.orDie, Effect.provide(Cli.platformLayer))

const bounded = <A>(effect: Effect.Effect<A, never, never>, what: string): Effect.Effect<A, never, never> =>
  Effect.flatMap(
    Effect.timeoutOption(effect, '60 seconds'),
    Option.match({
      onNone: () => Effect.die(new Error(`timed out waiting for ${what}`)),
      onSome: (value) => Effect.succeed(value),
    }),
  )

const toolEnvelopeOf = (response: JsonRpcMessage): Option.Option<CallToolEnvelope> =>
  S.decodeUnknownOption(CallToolResult)(response.result)

const toolNamesOf = (response: JsonRpcMessage): ReadonlyArray<string> =>
  Option.getOrElse(
    Option.map(S.decodeUnknownOption(ToolsListed)(response.result), (listed) =>
      listed.tools.map((tool) => tool.name).sort()),
    () => [],
  )

const survivorsOf = (
  response: JsonRpcMessage,
): ReadonlyArray<{ readonly id: string; readonly fileName: string; readonly line: number }> =>
  Option.getOrElse(
    Option.flatMap(toolEnvelopeOf(response), (call) =>
      S.decodeOption(S.fromJsonString(SurvivorList))(call.content.map((part) => part.text ?? '').join('\n'))),
    () => [],
  )

const toolCallOf = (response: JsonRpcMessage): ToolCall =>
  Option.match(toolEnvelopeOf(response), {
    onNone: () => ({ failed: true, structured: undefined, text: '' }),
    onSome: (call) => ({
      failed: call.isError === true,
      structured: Option.getOrUndefined(S.decodeUnknownOption(Mcp.MutantDetail)(call.structuredContent)),
      text: call.content.map((part) => part.text ?? '').join('\n'),
    }),
  })

const makeClient = (
  handle: ChildProcessSpawner.ChildProcessHandle,
): Effect.Effect<Client, never, Scope.Scope> =>
  Effect.gen(function*() {
    const input = yield* Queue.unbounded<Uint8Array, Cause.Done>()
    const output = yield* Queue.unbounded<string, Cause.Done>()
    yield* Effect.forkScoped(Stream.run(Stream.fromQueue(input), handle.stdin))
    yield* Effect.forkScoped(
      handle.stdout.pipe(
        Stream.decodeText,
        Stream.runForEach((chunk) => Queue.offer(output, chunk)),
      ),
    )
    yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.runDrain))

    const buffer = yield* Ref.make('')

    const next: Effect.Effect<string, never, never> = Effect.suspend(() =>
      Effect.gen(function*() {
        const text = yield* Ref.get(buffer)
        const newline = text.indexOf('\n')
        if (newline >= 0) {
          yield* Ref.set(buffer, text.slice(newline + 1))
          return text.slice(0, newline)
        }
        const chunk = yield* Queue.take(output).pipe(Effect.orDie)
        yield* Ref.update(buffer, (rest) => rest + chunk)
        return yield* next
      })
    )

    const write = (message: S.Json): Effect.Effect<void, never, never> =>
      Queue.offer(input, UTF8.encode(`${JSON.stringify(message)}\n`)).pipe(Effect.asVoid)

    const readFor = (id: number): Effect.Effect<JsonRpcMessage, never, never> =>
      Effect.gen(function*() {
        const line = yield* next
        const decoded = S.decodeOption(S.fromJsonString(JsonRpcResponse))(line)
        return yield* Option.match(decoded, {
          onNone: () => readFor(id),
          onSome: (response) => (response.id === id ? Effect.succeed(response) : readFor(id)),
        })
      })

    const call = (id: number, method: string, params: Record<string, S.Json>) =>
      bounded(write({ jsonrpc: '2.0', id, method, params }).pipe(Effect.andThen(readFor(id))), `${method} (id ${id})`)

    return {
      initialize: call(1, 'initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'stryker-integration-client', version: '1.0.0' },
      }),
      notify: (method: string) => write({ jsonrpc: '2.0', method }),
      call,
    }
  })

const drive = (directory: string): Effect.Effect<Omit<Observed, 'runCompleted'>, never, never> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, 'mcp'], {
          cwd: directory,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: 'machine', NO_COLOR: '1' },
          extendEnv: true,
        }),
      )
      const client = yield* makeClient(handle)

      const initialized = yield* client.initialize
      yield* client.notify('notifications/initialized')

      const toolNames = toolNamesOf(yield* client.call(2, 'tools/list', {}))
      const surfaced = survivorsOf(yield* client.call(3, 'tools/call', { name: 'list_survivors', arguments: {} }))
      const id = Option.getOrElse(Option.map(Option.fromNullishOr(surfaced[0]), (ref) => ref.id), () => '')

      const shown = toolCallOf(yield* client.call(4, 'tools/call', { name: 'show_mutant', arguments: { id } }))
      const rerun = toolCallOf(yield* client.call(5, 'tools/call', { name: 'rerun_mutant', arguments: { id } }))
      const useful = toolCallOf(
        yield* client.call(6, 'tools/call', {
          name: 'report_usefulness',
          arguments: { id, judgment: 'useful', reason: 'it looks wrong' },
        }),
      )
      const unknown = toolCallOf(
        yield* client.call(7, 'tools/call', {
          name: 'report_usefulness',
          arguments: { id: 'ffffffffffffffff', judgment: 'not-useful', reason: null },
        }),
      )

      const feedbackText = yield* readText(directory, FEEDBACK_FILE)
      const reportText = yield* readText(directory, REPORT_FILE)

      return {
        initialized: initialized.result !== undefined,
        toolNames,
        surfaced,
        shown,
        rerun,
        useful,
        unknown,
        feedbackLines: feedbackText.split('\n').filter((line) => line.length > 0),
        reportListsTheSurfacedId: reportText.includes(id),
      }
    }),
  ).pipe(Effect.orDie, Effect.provide(Cli.platformLayer))

Feature('An agent listing, inspecting and re-running mutants over MCP', { timeout: 180_000 })
  .withLayer(Cli.platformLayer)
  .live('the built stryker mcp server speaks JSON-RPC over stdio against a project the engine mutated')
  .body(({ scenario }) => {
    scenario(
      'A client lists survivors, shows one, re-runs it, and records a usefulness judgment',
      Gherkin.Do.pipe(
        Given('a consumer project whose test command kills nothing')('workspace', () => writeWorkspace()),
        When('the project is mutated by the CLI and an MCP client drives its server over stdio')(
          'observed',
          (s) =>
            Effect.gen(function*() {
              const seeded = yield* runStryker(s.workspace.directory, ['run'])
              const driven = yield* drive(s.workspace.directory)
              return { runCompleted: seeded.exitCode === 0, ...driven }
            }).pipe(Effect.ensuring(removeWorkspace(s.workspace.directory))),
        ),
        Then(
          'every tool answers from the same report, the re-run keeps the id, and one feedback line is recorded',
        )((s, expect) => {
          const shown = Option.getOrUndefined(
            S.decodeUnknownOption(Mcp.MutantDetail)(s.observed.shown.structured),
          )
          const rerun = Option.getOrUndefined(
            S.decodeUnknownOption(Mcp.MutantDetail)(s.observed.rerun.structured),
          )
          const id = Option.getOrElse(
            Option.map(Option.fromNullishOr(s.observed.surfaced[0]), (ref) => ref.id),
            () => '',
          )
          const recorded = Option.getOrUndefined(
            S.decodeOption(S.fromJsonString(RunEvent.FeedbackReported))(s.observed.feedbackLines[0] ?? ''),
          )
          return expect({
            runCompleted: s.observed.runCompleted,
            initialized: s.observed.initialized,
            toolNames: s.observed.toolNames,
            surfacedAtLeastOne: s.observed.surfaced.length > 0,
            surfacedIdIsInTheReport: s.observed.reportListsTheSurfacedId,
            shownFailed: s.observed.shown.failed,
            shownId: shown?.id === id,
            shownStatus: shown?.status,
            shownHasDiff: typeof shown?.diff === 'string' && shown.diff.includes('@@'),
            shownReproducer: shown?.reproducer === `stryker run --mutant ${id}`,
            rerunFailed: s.observed.rerun.failed,
            rerunId: rerun?.id === id,
            rerunStatus: rerun?.status,
            rerunCoveringTests: Array.isArray(rerun?.coveringTests),
            usefulFailed: s.observed.useful.failed,
            unknownRefused: s.observed.unknown.failed,
            recordedLineCount: s.observed.feedbackLines.length,
            recordedId: recorded?.id === id,
            recordedJudgment: recorded?.judgment,
            recordedReason: recorded?.reason,
          }).toEqual({
            runCompleted: true,
            initialized: true,
            toolNames: ['list_survivors', 'report_usefulness', 'rerun_mutant', 'show_mutant'],
            surfacedAtLeastOne: true,
            surfacedIdIsInTheReport: true,
            shownFailed: false,
            shownId: true,
            shownStatus: 'Survived',
            shownHasDiff: true,
            shownReproducer: true,
            rerunFailed: false,
            rerunId: true,
            rerunStatus: 'Survived',
            rerunCoveringTests: true,
            usefulFailed: false,
            unknownRefused: true,
            recordedLineCount: 1,
            recordedId: true,
            recordedJudgment: 'useful',
            recordedReason: 'it looks wrong',
          })
        }),
      ),
    )
  })
