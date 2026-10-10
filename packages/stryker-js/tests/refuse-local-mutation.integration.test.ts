import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Cli } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const CONSUMER_PACKAGE = '{ "name": "refuse-local-consumer", "type": "module", "private": true }\n'

const CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'off',
  concurrency: 1,
  reporters: [],
}
`

const decodeRefused = S.decodeUnknownOption(S.fromJsonString(RunEvent.Refused))

interface RunOutcome {
  readonly exitCode: number
  readonly refusedMessage: string | null
}

const prepareProject = (): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const binaryPresent = yield* fs.exists(STRYKER_BIN)
    yield* Effect.when(
      Effect.die(new Error('dist/main.mjs is missing — build the package first')),
      Effect.succeed(!binaryPresent),
    )
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-refuse-local-' }))
    yield* fs.makeDirectory(path.join(root, 'src'))
    yield* fs.writeFileString(path.join(root, 'package.json'), CONSUMER_PACKAGE)
    yield* fs.writeFileString(path.join(root, 'src', 'add.js'), 'export const add = (a, b) => a + b\n')
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), CONFIG)
    return root
  }).pipe(Effect.orDie)

const runStrykerLocally = (
  root: string,
): Effect.Effect<RunOutcome, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, 'run'], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: 'machine', NO_COLOR: '1', GITHUB_ACTIONS: '', ALLOW_LOCAL_MUTATION: '' },
          extendEnv: true,
        }),
      )
      const printed = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      const output = yield* Fiber.join(printed)
      const refused = output
        .trim()
        .split('\n')
        .map((line) => decodeRefused(line))
        .find(Option.isSome)
      return {
        exitCode: Number(exitCode),
        refusedMessage: refused === undefined ? null : refused.value.message,
      }
    }),
  ).pipe(Effect.orDie)

Feature('Refusing a mutation run that is not on main CI', { timeout: 180_000 })
  .withLayer(Cli.platformLayer)
  .live('the built stryker binary decides in a real Node process')
  .body(({ scenario }) => {
    scenario(
      'A local run exits non-zero and ends the machine stream with a refused line hiding the override',
      Gherkin.Do.pipe(
        Given('a consumer project with a valid config')('root', () => prepareProject()),
        When('stryker runs it locally in machine mode')('ran', (s) => runStrykerLocally(s.root)),
        Then('the process exits non-zero with a refused line that hides the override')((s, expect) =>
          expect({
            refusedNonZero: s.ran.exitCode !== 0,
            message: s.ran.refusedMessage,
            hidesOverride: (s.ran.refusedMessage ?? '').includes('ALLOW_LOCAL_MUTATION'),
          }).toEqual({
            refusedNonZero: true,
            message: 'mutation runs only on main CI',
            hidesOverride: false,
          })
        ),
      ),
    )
  })
