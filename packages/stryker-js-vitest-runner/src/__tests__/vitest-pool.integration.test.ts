import { NodeCrypto, NodeFileSystem, NodePath } from '@effect/platform-node'
import { Options, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Cause from 'effect/Cause'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import { join } from 'node:path'

import { layer } from '../VitestRunner.service.js'

const PACKAGE_ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/\/$/, '')
const FIXTURE_ROOT = join(PACKAGE_ROOT, 'testResources', 'simple-project')

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer)

const WITH_POOL = { plugin: 'vitest-runner-under-test', options: { pool: 'threads' } } as const
const WITHOUT_POOL = { plugin: 'vitest-runner-under-test' } as const

interface RunnerConfig {
  readonly plugin: string
  readonly options?: Record<string, unknown>
}

const refusalTextOf = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ''

const withSandbox = <A, E, R>(
  use: (directory: string) => Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path>,
): Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path> =>
  Effect.acquireUseRelease(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'vitest-pool-' }))
      yield* fs.copy(FIXTURE_ROOT, directory, { overwrite: true })
      yield* fs.symlink(path.join(PACKAGE_ROOT, 'node_modules'), path.join(directory, 'node_modules'))
      return directory
    }).pipe(Effect.orDie),
    use,
    (directory) =>
      FileSystem.FileSystem.pipe(
        Effect.flatMap((fs) => fs.remove(directory, { recursive: true, force: true })),
        Effect.orDie,
      ),
  )

const SETUP_FILE = join(PACKAGE_ROOT, 'dist', 'stryker-setup.mjs')

const runnerLayerOf = (directory: string, testRunner: RunnerConfig, configFile?: string) =>
  Effect.gen(function*() {
    const options = yield* S.decodeUnknownEffect(Options.StrykerOptionsSchema)({
      testRunner: configFile === undefined
        ? testRunner
        : { ...testRunner, options: { ...testRunner.options, configFile } },
    })
    return layer({ options, sandboxDirectory: directory, setupFilePath: SETUP_FILE })
  })

const initRunner = (
  directory: string,
  testRunner: RunnerConfig,
  configFile?: string,
): Effect.Effect<TestRunner.DryRunResult | undefined, never, Crypto.Crypto | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const runnerLayer = yield* runnerLayerOf(directory, testRunner, configFile)
    return yield* Effect.gen(function*() {
      const runner = yield* TestRunner.TestRunner
      yield* runner.init
      return yield* runner.dryRun({ timeout: 60_000, coverageAnalysis: 'off', disableBail: false }).pipe(
        Effect.orElseSucceed(() => undefined),
      )
    }).pipe(Effect.provide(runnerLayer), Effect.scoped, Effect.orDie)
  }).pipe(Effect.orDie)

const attemptInit = (directory: string, testRunner: RunnerConfig, configFile?: string) =>
  Effect.gen(function*() {
    const runnerLayer = yield* runnerLayerOf(directory, testRunner, configFile)
    return yield* Effect.gen(function*() {
      const runner = yield* TestRunner.TestRunner
      yield* runner.init
    }).pipe(Effect.provide(runnerLayer), Effect.scoped, Effect.exit)
  }).pipe(Effect.provide(platform))

describe('vitest runner pool option', (it) => {
  it('runs a project on worker threads when pool is threads', function*({ expect }) {
    const outcome = yield* withSandbox((directory) => initRunner(directory, WITH_POOL)).pipe(
      Effect.provide(platform),
    )
    if (outcome === undefined || outcome.status !== 'complete') {
      throw new Error(`the pooled dry run did not complete: ${String(outcome?.status)}`)
    }
    const names = outcome.tests.map((test) => test.name)
    yield* expect({
      hasAdd: names.includes('add > should be able to add two numbers'),
      statuses: [...new Set(outcome.tests.map((test) => test.status))],
    }).toEqual({ hasAdd: true, statuses: ['success'] })
  })

  it('refuses a browser-mode project when pool is threads', function*({ expect }) {
    const exit = yield* withSandbox((directory) =>
      attemptInit(directory, WITH_POOL, join(directory, 'vitest.browser.config.js'))
    ).pipe(Effect.provide(platform))
    yield* expect(refusalTextOf(exit)).toContain("testRunner: 'vitest'")
  })

  it('does not refuse a browser-mode project when no pool is set', function*({ expect }) {
    const exit = yield* withSandbox((directory) =>
      attemptInit(directory, WITHOUT_POOL, join(directory, 'vitest.browser.config.js'))
    ).pipe(Effect.provide(platform))
    yield* expect(refusalTextOf(exit)).not.toContain("testRunner: 'vitest'")
  })
})
