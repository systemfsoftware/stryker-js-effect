import { Effect, Exit, Layer, ManagedRuntime, Scope } from 'effect'

import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import { Readiness } from '@systemfsoftware/effect-readiness'
import { VitestTestContext } from '@systemfsoftware/vitest'
import { step } from '@systemfsoftware/vitest/integration'

import type { Asserted } from '@systemfsoftware/vitest'

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

export type BddKind = 'Given' | 'When' | 'Then' | 'And'

const ANNOTATION_TYPE: Readonly<Record<BddKind, string>> = {
  Given: 'lifecycle',
  When: 'execution',
  Then: 'assertions',
  And: 'assertions',
}

const runOptions = (signal: AbortSignal | undefined): { readonly signal?: AbortSignal } =>
  signal === undefined ? {} : { signal }

const suiteSignal = (context: { readonly signal: AbortSignal } | null): AbortSignal | undefined => context?.signal

export const harness: Effect.Effect<MicroVMHarness, never, Scope.Scope> = Effect.gen(function*() {
  const signal = suiteSignal(yield* VitestTestContext)
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() => ManagedRuntime.make(HarnessLive)),
    (managed) => Effect.promise(() => managed.dispose()),
  )
  const run = async (
    warm: Warm.WarmSandbox,
    args: readonly string[],
    opts: { readonly label: string; readonly scope: Scope.Closeable; readonly signal?: AbortSignal },
  ): Promise<ForkedRun> =>
    runtime.runPromise(
      underActiveParentSpan(
        StrykerCliRunner.use((runner) => runner.run(args, warm, opts.label)).pipe(
          Scope.provide(opts.scope),
        ),
      ),
      runOptions(opts.signal ?? signal),
    )
  return {
    warm: (fixtureUrl: URL) =>
      runtime.runPromise(underActiveParentSpan(BakedFixtureCache.use((cache) => cache.warm(fixtureUrl)))),
    openScope: () => runtime.runPromise(Scope.make()),
    closeScope: (scope) => runtime.runPromise(Scope.close(scope, Exit.void)),
    run,
    readFile: (fork: Warm.SandboxFork, relativePath: string) => runtime.runPromise(Warm.readFile(fork, relativePath)),
  } satisfies MicroVMHarness
})

export const prepareFixture = (fixtureUrl: URL, name: string): Effect.Effect<PreparedFixture, never, Scope.Scope> =>
  Effect.gen(function*() {
    const microvm = yield* harness
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
    const warm = yield* Effect.promise(() => microvm.warm(fixtureUrl))
    const forks: Array<Warm.SandboxFork> = []
    return {
      run: async (args: readonly string[]) => {
        const run = await microvm.run(warm, args, { label: name, scope })
        forks.push(run.fork)
        return run.result
      },
      readFile: (relativePath: string) => {
        const latest = forks.at(-1)
        return latest === undefined
          ? Promise.reject(new Error(`${name}: read ${relativePath} before any run forked the fixture`))
          : microvm.readFile(latest, relativePath)
      },
    } satisfies PreparedFixture
  })

export const bddStep = <A, E, R>(
  kind: BddKind,
  description: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | Asserted> =>
  Effect.gen(function*() {
    const context = yield* VitestTestContext
    if (context !== null) {
      yield* Effect.promise(() => context.annotate(`${kind} ${description}`, ANNOTATION_TYPE[kind]))
    }
    return yield* step(effect)
  })
