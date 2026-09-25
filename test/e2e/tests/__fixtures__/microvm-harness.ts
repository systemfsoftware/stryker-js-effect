import { Exit, Layer, ManagedRuntime, Scope } from 'effect'

import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import { Readiness } from '@systemfsoftware/effect-readiness'

import { test as baseTest } from 'vitest'

import { BakedFixtureCache } from '../../src/Harness/fixture-cache.service.js'
import type { ExecResult } from '../../src/Harness/guest-job.schema.js'
import { GuestJobs } from '../../src/Harness/guest-job.service.js'
import { layer as harnessTelemetryLayer, underActiveParentSpan } from '../../src/Harness/harness-telemetry.service.js'
import { type ForkedRun, StrykerCliRunner } from '../../src/Harness/stryker-cli-runner.service.js'
import * as Warm from '../../src/Harness/warm-sandbox.handle.js'

const HarnessLive = Layer.mergeAll(
  BakedFixtureCache.layer,
  StrykerCliRunner.layer,
  GuestJobs.layer,
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(nodeServicesLayer, Readiness.NodeHostProber.layer, harnessTelemetryLayer),
  ),
)

export interface MicroVMHarness {
  readonly warm: (fixtureUrl: URL) => Promise<Warm.WarmSandbox>
  readonly openScope: () => Promise<Scope.Closeable>
  readonly closeScope: (scope: Scope.Closeable) => Promise<void>
  readonly run: (
    warm: Warm.WarmSandbox,
    args: readonly string[],
    opts: { readonly label: string; readonly scope: Scope.Closeable; readonly signal?: AbortSignal },
  ) => Promise<ForkedRun>
  readonly readFile: (fork: Warm.SandboxFork, relativePath: string) => Promise<string>
}
export interface PreparedFixture {
  readonly run: (args: readonly string[]) => Promise<ExecResult>
  readonly readFile: (relativePath: string) => Promise<string>
}

export interface BddStepContext {
  readonly given: (description: string, fn?: () => Promise<void> | void) => Promise<void>
  readonly when: (description: string, fn?: () => Promise<void> | void) => Promise<void>
  readonly thenAssert: (description: string, fn?: () => Promise<void> | void) => Promise<void>
  readonly and: (description: string, fn?: () => Promise<void> | void) => Promise<void>
}

export interface ExtendedTestContext {
  readonly microvmHarness: MicroVMHarness
  readonly prepareFixture: (fixtureUrl: URL, name: string) => Promise<PreparedFixture>
  readonly bdd: BddStepContext
}

export const test = baseTest
  .extend<Pick<ExtendedTestContext, 'microvmHarness'>>({
    microvmHarness: [
      async ({ onTestFinished: _onTestFinished }, use) => {
        const runtime = ManagedRuntime.make(HarnessLive)
        try {
          await use(
            {
              warm: (fixtureUrl: URL) =>
                runtime.runPromise(underActiveParentSpan(BakedFixtureCache.use((cache) => cache.warm(fixtureUrl)))),
              openScope: () => runtime.runPromise(Scope.make()),
              closeScope: (scope) => runtime.runPromise(Scope.close(scope, Exit.void)),
              run: (warm, args, opts) =>
                runtime.runPromise(
                  underActiveParentSpan(
                    StrykerCliRunner.use((runner) => runner.run(args, warm, opts.label)).pipe(
                      Scope.provide(opts.scope),
                    ),
                  ),
                  { signal: opts.signal },
                ),
              readFile: (fork, relativePath) => runtime.runPromise(Warm.readFile(fork, relativePath)),
            } satisfies MicroVMHarness,
          )
        } finally {
          await runtime.dispose()
        }
      },
      { scope: 'file' },
    ],
  })
  .extend<Pick<ExtendedTestContext, 'prepareFixture' | 'bdd'>>({
    prepareFixture: async ({ microvmHarness, signal }, use) => {
      const scope = await microvmHarness.openScope()
      try {
        await use(async (fixtureUrl: URL, name: string): Promise<PreparedFixture> => {
          const warm = await microvmHarness.warm(fixtureUrl)
          const forks: Array<Warm.SandboxFork> = []
          return {
            run: async (args: readonly string[]) => {
              const run = await microvmHarness.run(warm, args, { label: name, scope, signal })
              forks.push(run.fork)
              return run.result
            },
            readFile: (relativePath: string) => {
              const latest = forks.at(-1)
              return latest === undefined
                ? Promise.reject(new Error(`${name}: read ${relativePath} before any run forked the fixture`))
                : microvmHarness.readFile(latest, relativePath)
            },
          }
        })
      } finally {
        await microvmHarness.closeScope(scope)
      }
    },
    bdd: async ({ annotate }, use) => {
      await use(
        {
          given: async (desc, fn) => {
            await annotate(`Given ${desc}`, 'lifecycle')
            if (fn) await fn()
          },
          when: async (desc, fn) => {
            await annotate(`When ${desc}`, 'execution')
            if (fn) await fn()
          },
          thenAssert: async (desc, fn) => {
            await annotate(`Then ${desc}`, 'assertions')
            if (fn) await fn()
          },
          and: async (desc, fn) => {
            await annotate(`And ${desc}`, 'assertions')
            if (fn) await fn()
          },
        } satisfies BddStepContext,
      )
    },
  })

export { describe, expect, it } from 'vitest'
export type { ExpectStatic } from 'vitest'
