import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'

const Feature = makeFeature({ it })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)
const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const SOURCE = `export const add = (a, b) => a + b
export const isPositive = (n) => n > 0
`

const CONSUMER_PACKAGE = '{ "name": "break-threshold-consumer", "type": "module", "private": true }\n'

const configWithBreak = (breakThreshold: number | null) =>
  `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'off',
  concurrency: 1,
  reporters: ['clear-text'],
  thresholds: { high: 80, low: 60, break: ${String(breakThreshold)} },
}
`

const decodeVerdictLine = S.decodeUnknownOption(S.fromJsonString(S.TaggedStruct('verdict', {})))

interface RunOutcome {
  readonly exitCode: number
  readonly lastLine: string
}

const prepareProject = (
  breakThreshold: number | null,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const binaryPresent = yield* fs.exists(STRYKER_BIN)
    yield* Effect.when(
      Effect.die(new Error('dist/main.mjs is missing — build the package first')),
      Effect.succeed(!binaryPresent),
    )
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-break-threshold-' }))
    yield* fs.makeDirectory(path.join(root, 'node_modules', '@systemfsoftware'), { recursive: true })
    yield* fs.symlink(PACKAGE_ROOT, path.join(root, 'node_modules', '@systemfsoftware', 'stryker-js'))
    yield* fs.makeDirectory(path.join(root, 'src'))
    yield* fs.writeFileString(path.join(root, 'package.json'), CONSUMER_PACKAGE)
    yield* fs.writeFileString(path.join(root, 'src', 'add.js'), SOURCE)
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), configWithBreak(breakThreshold))
    return root
  }).pipe(Effect.orDie)

const runStryker = (
  root: string,
  mode: 'human' | 'machine',
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
          env: { STRYKER_MODE: mode, NO_COLOR: '1' },
          extendEnv: true,
        }),
      )
      const printed = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      const output = yield* Fiber.join(printed)
      return { exitCode: Number(exitCode), lastLine: output.trim().split('\n').at(-1) ?? '' }
    }),
  ).pipe(Effect.orDie)

const endsWithVerdict = (line: string): boolean => Option.isSome(decodeVerdictLine(line))

Feature('Failing the build when the mutation score is under the break threshold', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs a consumer project in a real Node process')
  .body(({ scenario }) => {
    scenario(
      'A score under the break threshold exits 1',
      Gherkin.Do.pipe(
        Given('a project whose tests kill no mutant and whose break threshold is 100')(
          'root',
          () => prepareProject(100),
        ),
        When('stryker runs it in human mode')('ran', (s) => runStryker(s.root, 'human')),
        Then('the process exits 1')((s, expect) => expect(s.ran.exitCode).toBe(1)),
      ),
    )

    scenario(
      'A score under the break threshold exits 1 in machine mode and still ends the stream with the verdict',
      Gherkin.Do.pipe(
        Given('a project whose tests kill no mutant and whose break threshold is 100')(
          'root',
          () => prepareProject(100),
        ),
        When('stryker runs it in machine mode')('ran', (s) => runStryker(s.root, 'machine')),
        Then('the process exits 1 after writing the verdict envelope')((s, expect) =>
          expect({ exitCode: s.ran.exitCode, endsWithVerdict: endsWithVerdict(s.ran.lastLine) }).toEqual({
            exitCode: 1,
            endsWithVerdict: true,
          })
        ),
      ),
    )

    scenario(
      'Without a break threshold the same score exits 0',
      Gherkin.Do.pipe(
        Given('a project whose tests kill no mutant and that sets no break threshold')(
          'root',
          () => prepareProject(null),
        ),
        When('stryker runs it in human mode')('ran', (s) => runStryker(s.root, 'human')),
        Then('the process exits 0')((s, expect) => expect(s.ran.exitCode).toBe(0)),
      ),
    )
  })
