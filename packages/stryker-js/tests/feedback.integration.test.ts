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
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { Cli } from '@systemfsoftware/stryker-js'
import { CallToolResult, JsonRpcResponse, SurvivorList } from './__fixtures__/feedback.schema.js'

const Feature = makeFeature({ it })

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)
const MCP_PROTOCOL_VERSION = '2025-06-18'
const UTF8 = new TextEncoder()

const FEEDBACK_FILE = 'reports/mutation/feedback.jsonl'
const TARGET_FILE = 'src/sum.js'
const UNKNOWN = 'ffffffffffffffff'
const REASON = 'the guard is load-bearing'

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

type JsonRpcMessage = typeof JsonRpcResponse.Type
type CallToolEnvelope = typeof CallToolResult.Type

interface Workspace {
  readonly directory: string
}

interface CliRun {
  readonly exitCode: number
  readonly stdout: string
}

interface CliClient {
  readonly initialize: Effect.Effect<void, never, never>
  readonly callTool: (
    id: number,
    name: string,
    args: Record<string, S.Json>,
  ) => Effect.Effect<JsonRpcMessage, never, never>
}

interface Observed {
  readonly seededExitCode: number
  readonly survivorId: string
  readonly feedback: CliRun
  readonly unknownFeedback: CliRun
  readonly recordedThroughMcp: boolean
  readonly lines: ReadonlyArray<string>
}

const writeWorkspace = (): Effect.Effect<Workspace, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-feedback-' }))
    yield* fs.writeFileString(
      path.join(directory, 'package.json'),
      '{ "name": "feedback-consumer", "type": "module" }\n',
    )
    yield* fs.makeDirectory(path.join(directory, 'src'), { recursive: true })
    yield* fs.writeFileString(path.join(directory, TARGET_FILE), 'export const sum = (a, b) => a + b\n')
    yield* fs.writeFileString(path.join(directory, 'stryker.config.mjs'), CONFIG)
    return { directory }
  }).pipe(Effect.orDie, Effect.provide(Cli.platformLayer))

const removeWorkspace = (directory: string): Effect.Effect<void, never, never> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })).pipe(
    Effect.orDie,
    Effect.provide(Cli.platformLayer),
  )

const readFeedback = (directory: string): Effect.Effect<ReadonlyArray<string>, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(directory, FEEDBACK_FILE)).pipe(Effect.orElseSucceed(() => ''))
    return text.split('\n').filter((line) => line.length > 0)
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

const withMcpProcess = <A>(
  root: string,
  body: (client: CliClient) => Effect.Effect<A, never, never>,
): Effect.Effect<A, never, never> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, 'mcp'], {
          cwd: root,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: 'machine', NO_COLOR: '1' },
          extendEnv: true,
        }),
      )
      const incoming = yield* Queue.unbounded<string, Cause.Done>()
      yield* Effect.forkScoped(
        handle.stdout.pipe(
          Stream.decodeText,
          Stream.splitLines,
          Stream.filter((line) => line.length > 0),
          Stream.runForEach((line) => Queue.offer(incoming, line)),
        ),
      )
      yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.runDrain))

      const outgoing = yield* Queue.unbounded<Uint8Array, Cause.Done>()
      yield* Effect.forkScoped(Stream.run(Stream.fromQueue(outgoing), handle.stdin))
      const send = (message: S.Json) =>
        Queue.offer(outgoing, UTF8.encode(`${JSON.stringify(message)}\n`)).pipe(Effect.asVoid)

      const readFor = (id: number): Effect.Effect<JsonRpcMessage, never, never> =>
        Effect.gen(function*() {
          const line = yield* Queue.take(incoming).pipe(Effect.orDie)
          const decoded = S.decodeOption(S.fromJsonString(JsonRpcResponse))(line)
          return yield* Option.match(decoded, {
            onNone: () => readFor(id),
            onSome: (response) => (response.id === id ? Effect.succeed(response) : readFor(id)),
          })
        })

      const initialize = send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'stryker-cli-client', version: '1.0.0' },
        },
      }).pipe(
        Effect.andThen(bounded(readFor(1), 'initialize')),
        Effect.andThen(send({ jsonrpc: '2.0', method: 'notifications/initialized' })),
        Effect.asVoid,
      )

      return yield* body({
        initialize,
        callTool: (id, name, args) =>
          send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }).pipe(
            Effect.andThen(bounded(readFor(id), `tools/call ${name}`)),
          ),
      })
    }),
  ).pipe(Effect.orDie, Effect.provide(Cli.platformLayer))

const recordedLineOf = (text: string | undefined): Option.Option<RunEvent.FeedbackReported> =>
  Option.flatMap(
    Option.fromNullishOr(text),
    (line) => S.decodeOption(S.fromJsonString(RunEvent.FeedbackReported))(line),
  )

const toolEnvelopeOf = (response: JsonRpcMessage): Option.Option<CallToolEnvelope> =>
  S.decodeUnknownOption(CallToolResult)(response.result)

const toolFailed = (response: JsonRpcMessage): boolean =>
  Option.match(toolEnvelopeOf(response), {
    onNone: () => true,
    onSome: (result) => result.isError === true,
  })

const surfacedIdsOf = (response: JsonRpcMessage): ReadonlyArray<{ readonly id: string }> =>
  Option.getOrElse(
    Option.flatMap(toolEnvelopeOf(response), (call) =>
      S.decodeOption(S.fromJsonString(SurvivorList))(call.content.map((part) => part.text ?? '').join('\n'))),
    () => [],
  )

const observe = (directory: string): Effect.Effect<Observed, never, never> =>
  Effect.gen(function*() {
    const seeded = yield* runStryker(directory, ['run'])
    const recorded = yield* withMcpProcess(directory, (client) =>
      Effect.gen(function*() {
        yield* client.initialize
        const surfaced = surfacedIdsOf(yield* client.callTool(2, 'list_survivors', {}))
        const id = Option.getOrElse(Option.map(Option.fromNullishOr(surfaced[0]), (ref) => ref.id), () => '')
        const response = yield* client.callTool(3, 'report_usefulness', {
          id,
          judgment: 'not-useful',
          reason: REASON,
        })
        return { id, failed: toolFailed(response) }
      }))
    const feedback = yield* runStryker(directory, ['feedback', recorded.id, '--not-useful', '--reason', REASON])
    const unknownFeedback = yield* runStryker(directory, ['feedback', UNKNOWN, '--useful'])
    const lines = yield* readFeedback(directory)
    return {
      seededExitCode: seeded.exitCode,
      survivorId: recorded.id,
      feedback,
      unknownFeedback,
      recordedThroughMcp: !recorded.failed,
      lines,
    }
  })

Feature('Recording a usefulness judgment from the CLI and from MCP', { timeout: 180_000 })
  .withLayer(Cli.platformLayer)
  .live('the built stryker binary appends to the same feedback log from both subcommands')
  .body(({ scenario }) => {
    scenario(
      'The feedback command and the MCP tool append the identical line, and an unknown id is refused',
      Gherkin.Do.pipe(
        Given('a consumer project whose test command kills nothing')('workspace', () => writeWorkspace()),
        When('the survivor is judged not useful from the CLI and from MCP, and an unknown id from the CLI')(
          'observed',
          (s) => observe(s.workspace.directory).pipe(Effect.ensuring(removeWorkspace(s.workspace.directory))),
        ),
        Then('both writers append the same line and the unknown id adds nothing')((s, expect) => {
          const byCli = recordedLineOf(s.observed.lines[0])
          const byMcp = recordedLineOf(s.observed.lines[1])
          const survivor = s.observed.survivorId
          return expect({
            seededExitCode: s.observed.seededExitCode,
            survivorIdIsKnown: survivor.length > 0,
            feedbackExitCode: s.observed.feedback.exitCode,
            unknownExitCodeIsZero: s.observed.unknownFeedback.exitCode === 0,
            recordedThroughMcp: s.observed.recordedThroughMcp,
            lineCount: s.observed.lines.length,
            linesAreIdentical: s.observed.lines[0] === s.observed.lines[1],
            cliId: Option.map(byCli, (line) => line.id),
            cliJudgment: Option.map(byCli, (line) => line.judgment),
            cliReason: Option.map(byCli, (line) => line.reason),
            mcpId: Option.map(byMcp, (line) => line.id),
            mcpJudgment: Option.map(byMcp, (line) => line.judgment),
            mcpReason: Option.map(byMcp, (line) => line.reason),
          }).toEqual({
            seededExitCode: 0,
            survivorIdIsKnown: true,
            feedbackExitCode: 0,
            unknownExitCodeIsZero: false,
            recordedThroughMcp: true,
            lineCount: 2,
            linesAreIdentical: true,
            cliId: Option.some(survivor),
            cliJudgment: Option.some('not-useful'),
            cliReason: Option.some(REASON),
            mcpId: Option.some(survivor),
            mcpJudgment: Option.some('not-useful'),
            mcpReason: Option.some(REASON),
          })
        }),
      ),
    )
  })
