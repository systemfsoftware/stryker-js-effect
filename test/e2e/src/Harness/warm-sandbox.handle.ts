import { Handle } from '@systemfsoftware/effect-cell-types'
import { MicroVM } from '@systemfsoftware/effect-microsandbox'
import { Boolean, Effect } from 'effect'
import * as Crypto from 'effect/Crypto'
import type * as Scope from 'effect/Scope'
import { NetworkPolicy, Sandbox, Snapshot } from 'microsandbox'

import type { ExecResult } from './guest-job.schema.js'
import { GuestJobs } from './guest-job.service.js'
import { ExitFailure, GuestJobFailure, SandboxForkFailure } from './harness-failure.schema.js'

export interface WarmSandboxSnapshot {
  readonly reference: string
  readonly referenceKind: 'id' | 'path'
}

interface WarmSandboxData {
  readonly fixtureId: string
  readonly snapshot: WarmSandboxSnapshot
}

export const TypeId = Symbol.for('~systemfsoftware/stryker-e2e/WarmSandbox')
export type TypeId = typeof TypeId

const WarmSandboxDef = Handle.make<WarmSandboxData>()(TypeId)

export type WarmSandbox = Handle.Of<typeof WarmSandboxDef>

export const isWarmSandbox = WarmSandboxDef.is

interface SandboxForkData {
  readonly name: string
}

interface SandboxForkSlot {
  readonly sandbox: Sandbox
}

export const ForkTypeId = Symbol.for('~systemfsoftware/stryker-e2e/SandboxFork')
export type ForkTypeId = typeof ForkTypeId

const SandboxForkDef = Handle.make<SandboxForkData, SandboxForkSlot>()(ForkTypeId)

export type SandboxFork = Handle.Of<typeof SandboxForkDef>

export const isSandboxFork = SandboxForkDef.is

const sandboxOf = (forked: SandboxFork): Sandbox => SandboxForkDef.slot(forked).sandbox

const IDLE_WORKLOAD = ['tail', '-f', '/dev/null'] as const
const HOST_ACCESS_PROFILES = ['public', 'host'] as const
const STOP_TIMEOUT_MS = 10_000
const KILL_TIMEOUT_MS = 5_000
const NAME_SUFFIX_CHARS = 8

const describe = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

const populateScript =
  `mkdir -p ${GuestJobs.GUEST_WORKROOT} && cp -a ${GuestJobs.GUEST_BAKED_ROOT}/. ${GuestJobs.GUEST_WORKROOT}/ && sync && echo 3 > /proc/sys/vm/drop_caches`

const uniqueName = (label: string) =>
  Effect.flatMap(
    Crypto.Crypto,
    (crypto) => Effect.map(Effect.orDie(crypto.randomUUIDv4), (uuid) => `${label}-${uuid.slice(0, NAME_SUFFIX_CHARS)}`),
  )

const bootAndCapture = (bakedFixtureDir: string, fixtureId: string, snapshotName: string) =>
  Effect.scoped(Effect.gen(function*() {
    const jobs = yield* GuestJobs
    const step = `boot the warm ${fixtureId} microVM`
    const vm = yield* jobs.job(IDLE_WORKLOAD, [{ host: bakedFixtureDir, guest: GuestJobs.GUEST_BAKED_ROOT }])
      .scoped
      .pipe(Effect.mapError((cause) => new GuestJobFailure({ step, cause })))
    const populated = yield* MicroVM.exec(vm, 'sh', ['-c', populateScript]).pipe(
      Effect.mapError((cause) => new GuestJobFailure({ step, cause })),
    )
    yield* Boolean.match(populated.code === 0, {
      onTrue: () => Effect.void,
      onFalse: () =>
        Effect.fail(
          new ExitFailure({
            step: `copy the baked ${fixtureId} fixture onto the warm microVM disk`,
            exitCode: populated.code,
            stderrTail: populated.stderr.slice(-GuestJobs.STDERR_TAIL_CHARS),
          }),
        ),
    })
    return yield* MicroVM.use(
      vm,
      (sandbox) => Snapshot.builder(snapshotName).fromSandbox(sandbox.name).full().guestFlush('required').create(),
    ).pipe(
      Effect.map((snapshot): WarmSandboxSnapshot => ({
        reference: snapshot.reference,
        referenceKind: snapshot.referenceKind,
      })),
      Effect.mapError((error) =>
        new SandboxForkFailure({
          step: `snapshot the warm ${fixtureId} microVM`,
          sandboxName: error.sandboxName,
          detail: describe(error.cause),
        })
      ),
    )
  }))

export const boot = (bakedFixtureDir: string, fixtureId: string) =>
  Effect.gen(function*() {
    const snapshotName = yield* uniqueName(fixtureId)
    const snapshot = yield* Effect.acquireRelease(
      bootAndCapture(bakedFixtureDir, fixtureId, snapshotName),
      (captured) =>
        Effect.promise(() => Snapshot.remove(captured.reference, { force: true })).pipe(
          Effect.catchDefect(() => Effect.void),
          Effect.uninterruptible,
        ),
    )
    return WarmSandboxDef.make({ fixtureId, snapshot })
  })

const teardown = (sandbox: Sandbox) =>
  Effect.gen(function*() {
    yield* Effect.promise(() => sandbox.stopWithTimeout(STOP_TIMEOUT_MS)).pipe(
      Effect.catchDefect(() =>
        Effect.promise(() => sandbox.killWithTimeout(KILL_TIMEOUT_MS)).pipe(Effect.catchDefect(() => Effect.void))
      ),
    )
    yield* Effect.promise(() => sandbox.destroy({ force: true })).pipe(Effect.catchDefect(() => Effect.void))
  }).pipe(Effect.uninterruptible)

export const fork = (
  warm: WarmSandbox,
  label: string,
): Effect.Effect<SandboxFork, SandboxForkFailure, Crypto.Crypto | Scope.Scope> =>
  Effect.gen(function*() {
    const name = yield* uniqueName(label)
    return yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          Sandbox.restore(warm.snapshot)
            .name(name)
            .forked()
            .allowMissingResources()
            .networkPolicy(NetworkPolicy.fromProfiles(HOST_ACCESS_PROFILES))
            .restore(),
        catch: (cause) =>
          new SandboxForkFailure({
            step: `fork the warm ${warm.fixtureId} snapshot`,
            sandboxName: name,
            detail: describe(cause),
          }),
      }).pipe(Effect.map((sandbox): SandboxFork => SandboxForkDef.make({ name }, { sandbox }))),
      (forked) => teardown(sandboxOf(forked)),
    )
  })

export const exec = (
  forked: SandboxFork,
  argv: readonly [string, ...Array<string>],
  env: Record<string, string>,
): Effect.Effect<ExecResult, SandboxForkFailure> => {
  const [cmd, ...args] = argv
  return Effect.tryPromise({
    try: () => sandboxOf(forked).execWith(cmd, (options) => options.args(args).cwd(GuestJobs.GUEST_WORKROOT).envs(env)),
    catch: (cause) =>
      new SandboxForkFailure({ step: `run ${argv.join(' ')}`, sandboxName: forked.name, detail: describe(cause) }),
  }).pipe(Effect.map((output) => ({ exitCode: output.code, stdout: output.stdout(), stderr: output.stderr() })))
}

export const readFile = (forked: SandboxFork, relativePath: string): Effect.Effect<string, SandboxForkFailure> =>
  Effect.tryPromise({
    try: () => sandboxOf(forked).fs().readToString(`${GuestJobs.GUEST_WORKROOT}/${relativePath}`),
    catch: (cause) =>
      new SandboxForkFailure({ step: `read ${relativePath}`, sandboxName: forked.name, detail: describe(cause) }),
  })
