import { describe, expect, it } from '@effect/vitest'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { layer as NodeCryptoLayer } from '@effect/platform-node/NodeCrypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import { type StrykerOptions, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { layer } from '../VitestRunner.service.js'

const platform = Layer.mergeAll(NodeCryptoLayer, NodeFileSystem.layer, NodePath.layer)

describe('tmp-finalizer-probe', () => {
  it('runner alive across two RPCs, finalized only at shutdown', async () => {
    const sandbox = await Effect.runPromise(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const dir = yield* fs.makeTempDirectory()
        const setup = `${dir}/setup.mjs`
        yield* fs.writeFileString(setup, 'export default {};\n')
        return { dir, setup }
      }).pipe(Effect.provide(platform)),
    )
    const options: StrykerOptions = {
      allowConsoleColors: true,
      checkers: [],
      checkerNodeArgs: [],
      commandRunner: { command: 'npm test' },
      coverageAnalysis: 'perTest',
      clearTextReporter: {
        allowColor: true,
        allowEmojis: false,
        logTests: true,
        maxTestsToLog: 3,
        reportTests: true,
        reportMutants: true,
        reportScoreTable: true,
        skipFull: false,
      },
      dryRunOnly: false,
      ignorePatterns: [],
      ignoreStatic: false,
      incremental: false,
      incrementalFile: 'reports/stryker-incremental.json',
      progressStreamFile: 'reports/mutation-stream.jsonl',
      force: false,
      fileLogLevel: 'off',
      inPlace: false,
      logLevel: 'info',
      maxConcurrentTestRunners: 9007199254740991,
      maxTestRunnerReuse: 0,
      mutate: [
        '{src,lib}/**/!(*.+(s|S)pec|*.+(t|T)est).+(cjs|mjs|js|ts|mts|cts|jsx|tsx|html|vue|svelte)',
        '!{src,lib}/**/__tests__/**/*.+(cjs|mjs|js|ts|mts|cts|jsx|tsx|html|vue|svelte)',
      ],
      mutator: { excludedMutations: [] },
      plugins: [],
      appendPlugins: [],
      reporters: ['clear-text', 'progress', 'html'],
      htmlReporter: { fileName: 'reports/mutation/mutation.html' },
      jsonReporter: { fileName: 'reports/mutation/mutation.json' },
      disableTypeChecks: true,
      symlinkNodeModules: true,
      tempDirName: '.stryker-tmp',
      cleanTempDir: true,
      testRunner: 'command',
      testRunnerNodeArgs: [],
      thresholds: { high: 80, low: 60, break: null },
      timeoutFactor: 1.5,
      timeoutMS: 5000,
      dryRunTimeoutMinutes: 5,
      tsconfigFile: 'tsconfig.json',
      warnings: true,
      disableBail: false,
      allowEmpty: false,
      ignorers: [],
      testFiles: [],
    }
    const runnerLayer = layer({ options, sandboxDirectory: sandbox.dir, setupFilePath: sandbox.setup })
    const { beforeDispose, afterDispose } = await Effect.runPromise(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const countSetupFiles = Effect.gen(function*() {
          const entries = yield* fs.readDirectory(sandbox.dir)
          return entries.filter((entry) => entry.startsWith('stryker-setup-')).length
        })
        const context = yield* Layer.build(Layer.provide(runnerLayer, platform))
        const runner = context.get(TestRunner)
        yield* runner.init
        yield* runner.capabilities
        yield* runner.capabilities
        const before = yield* countSetupFiles
        yield* runner.dispose
        const after = yield* countSetupFiles
        return { beforeDispose: before, afterDispose: after }
      }).pipe(Effect.provide(platform), Effect.scoped),
    )
    console.log(`setup files after two RPCs: ${beforeDispose}, after dispose: ${afterDispose}`)
    expect(beforeDispose).toBe(1)
    expect(afterDispose).toBe(0)
    await Effect.runPromise(
      FileSystem.FileSystem.pipe(
        Effect.flatMap((fs) => fs.remove(sandbox.dir, { recursive: true })),
        Effect.provide(platform),
      ),
    )
  })
})
