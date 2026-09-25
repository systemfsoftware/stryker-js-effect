import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'

import { LoadedConfigSchema } from './__fixtures__/loaded-config.schema.js'

const Feature = makeFeature({ it })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)
const TSC = decodeURIComponent(new URL('../../../node_modules/.bin/tsc', import.meta.url).pathname)

interface ConsumerFile {
  readonly name: string
  readonly content: string
}

const TYPED_CONFIG =
  `import { defineConfig, mergeConfig, type ConfigEnv, type StrykerConfig } from '@systemfsoftware/stryker-js/config'

const base: StrykerConfig = { concurrency: 2, thresholds: { low: 50 } }
const config: StrykerConfig = defineConfig({ testRunner: 'vm', mutate: ['src/**/*.ts'] })

const fromFactory = defineConfig((env: ConfigEnv): StrykerConfig => ({ concurrency: env.isCi ? 8 : 2 }))
const fromPromise = defineConfig(Promise.resolve<StrykerConfig>({ concurrency: 6 }))
const merged: StrykerConfig = mergeConfig(base, { concurrency: 4, thresholds: { high: 70 } })

export default config
export { base, fromFactory, fromPromise, merged }
`

const TYPED_TSCONFIG = `{
  "compilerOptions": {
    "strict": true,
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "skipLibCheck": true,
    "types": [],
    "noEmit": true
  },
  "files": ["gatekeeper.config.ts"]
}
`

const RUNTIME_CONFIG = `import { defineConfig, mergeConfig } from '@systemfsoftware/stryker-js/config'

const base = { concurrency: 2, thresholds: { low: 50 } }
const config = defineConfig({ testRunner: 'vm', mutate: ['src/**/*.ts'] })
const fromFactory = defineConfig((env) => ({ concurrency: env.isCi ? 8 : 2 }))
const fromPromise = defineConfig(Promise.resolve({ concurrency: 6 }))
const merged = mergeConfig(base, { concurrency: 4, thresholds: { high: 70 } })

console.log(JSON.stringify({
  testRunner: config.testRunner,
  baseConcurrency: base.concurrency,
  factoryConcurrency: fromFactory({ command: 'run', isDryRun: false, mode: 'machine', isCi: true }).concurrency,
  promisedConcurrency: (await fromPromise).concurrency,
  mergedConcurrency: merged.concurrency,
  mergedLow: merged.thresholds.low,
  mergedHigh: merged.thresholds.high,
}))
`

const CONSUMER_PACKAGE = JSON.stringify({ name: 'config-entry-consumer', type: 'module', private: true })

const decodeLoadedConfig = S.decodeUnknownEffect(S.fromJsonString(LoadedConfigSchema))

interface CommandOutcome {
  readonly exitCode: number
  readonly output: string
}

const prepareConsumer = (
  files: readonly ConsumerFile[],
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    for (const built of ['config.mjs', 'config.d.mts'] as const) {
      const present = yield* fs.exists(path.join(PACKAGE_ROOT, 'dist', built))
      if (!present) {
        return yield* Effect.die(
          new Error(
            `dist/${built} is missing — build the package first (pnpm --filter @systemfsoftware/stryker-js build)`,
          ),
        )
      }
    }
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-config-entry-' }))
    yield* fs.makeDirectory(path.join(root, 'node_modules', '@systemfsoftware'), { recursive: true })
    yield* fs.symlink(PACKAGE_ROOT, path.join(root, 'node_modules', '@systemfsoftware', 'stryker-js'))
    yield* fs.writeFileString(path.join(root, 'package.json'), CONSUMER_PACKAGE)
    for (const file of files) {
      yield* fs.writeFileString(path.join(root, file.name), file.content)
    }
    return root
  }).pipe(Effect.orDie)

const runCommand = (
  root: string,
  executable: string,
  args: readonly string[],
): Effect.Effect<
  CommandOutcome,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(executable, [...args], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        }),
      )
      const printed = yield* Effect.forkScoped(handle.all.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      const output = yield* Fiber.join(printed)
      return { exitCode: Number(exitCode), output }
    }),
  ).pipe(Effect.orDie)

const diagnosticsOf = (output: string): readonly string[] =>
  output.split('\n').filter((line) => line.includes('error TS'))

Feature('Keeping the published ./config authoring surface working from a consumer project', { timeout: 120_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live(
    'the configuration is compiled and loaded by real TypeScript and Node processes reading the built package from the host filesystem',
  )
  .body(({ scenario }) => {
    scenario(
      'A configuration written against the published surface typechecks against the built declarations',
      Gherkin.Do.pipe(
        Given(
          'a consumer project linking the built package, carrying a configuration written against the published ./config surface',
        )(
          'root',
          () =>
            prepareConsumer([
              { name: 'gatekeeper.config.ts', content: TYPED_CONFIG },
              { name: 'tsconfig.json', content: TYPED_TSCONFIG },
            ]),
        ),
        When('the TypeScript compiler typechecks that configuration through the package name')(
          'compiled',
          (s) => runCommand(s.root, TSC, ['-p', 'tsconfig.json']),
        ),
        Then('the configuration typechecks with no diagnostics of its own')((s, expect) =>
          expect({ exitCode: s.compiled.exitCode, diagnostics: diagnosticsOf(s.compiled.output) }).toEqual({
            exitCode: 0,
            diagnostics: [],
          })
        ),
      ),
    )

    scenario(
      'A configuration written against the published surface loads and the helpers behave as promised',
      Gherkin.Do.pipe(
        Given(
          'a consumer project linking the built package, carrying a configuration written against the published ./config surface',
        )(
          'root',
          () => prepareConsumer([{ name: 'config-run.mjs', content: RUNTIME_CONFIG }]),
        ),
        When('a plain Node process runs that configuration through the package name')(
          'ran',
          (s) =>
            Effect.gen(function*() {
              const ran = yield* runCommand(s.root, globalThis.process.execPath, ['config-run.mjs'])
              const loaded = yield* decodeLoadedConfig(ran.output)
              return { exitCode: ran.exitCode, loaded }
            }).pipe(Effect.orDie),
        ),
        Then('the helpers behave as the published ./config surface promises')((s, expect) =>
          expect({ exitCode: s.ran.exitCode, loaded: s.ran.loaded }).toEqual({
            exitCode: 0,
            loaded: {
              testRunner: 'vm',
              baseConcurrency: 2,
              factoryConcurrency: 8,
              promisedConcurrency: 6,
              mergedConcurrency: 4,
              mergedLow: 50,
              mergedHigh: 70,
            },
          })
        ),
      ),
    )
  })
