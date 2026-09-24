import { ErrorText, InstrumenterContext } from '@systemfsoftware/stryker-js-instrumenter'
import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { isCustomTestRunner, TestRunnerFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Context from 'effect/Context'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'

import {
  close,
  type HarnessKey,
  type HarnessValue,
  provideValue,
  setMode,
  type VitestRuntime,
} from './VitestRuntime.handle.js'
import { create, resolveVitest, type VitestResolver } from './VitestRuntime.resource.js'
import {
  type StrykerNamespace,
  type VitestRunnerOptions,
  VitestRunnerOptionsSchema,
} from './VitestRunner.schema.js'

/** Everything one worker's run of the vitest runner is configured with. */
export interface VitestSessionInput {
  readonly options: StrykerOptions
  readonly sandboxDirectory: string
  readonly globalNamespace?: StrykerNamespace
  readonly resolveVitestFor?: VitestResolver
  readonly setupFilePath?: string
}

/**
 * The session a run works through: the live runtime, the options it was built
 * with, and the two writes a run makes before it collects.
 */
export interface VitestSessionShape {
  readonly options: Effect.Effect<VitestRunnerOptions, TestRunnerFailed>
  readonly runtime: Effect.Effect<VitestRuntime, TestRunnerFailed>
  readonly setMode: (mode: 'dry-run' | 'mutant') => Effect.Effect<void, TestRunnerFailed>
  readonly provide: (key: HarnessKey, value: HarnessValue) => Effect.Effect<void, TestRunnerFailed>
  readonly close: Effect.Effect<void, TestRunnerFailed>
}

const decodeOptions = (options: StrykerOptions): Effect.Effect<VitestRunnerOptions, TestRunnerFailed> =>
  S.decodeEffect(VitestRunnerOptionsSchema)(
    Match.value(options.testRunner).pipe(
      Match.when(isCustomTestRunner, (runner) => Option.getOrElse(Option.fromNullishOr(runner.options), () => ({}))),
      Match.orElse(() => ({})),
    ),
  ).pipe(
    Effect.mapError((cause) =>
      new TestRunnerFailed({ runnerName: 'vitest', phase: 'init', cause: Option.getOrElse(Option.map(ErrorText.fromCause(cause), (rendered) => rendered.text), () => '') })),
  )

export class VitestSession extends Context.Service<VitestSession, VitestSessionShape>()(
  '@systemfsoftware/stryker-js-vitest-runner/VitestSession',
) {
  static readonly layer = (
    input: VitestSessionInput,
  ): Layer.Layer<VitestSession, never, Crypto.Crypto | FileSystem.FileSystem | Path.Path> =>
    Layer.effect(
      VitestSession,
      Effect.gen(function*() {
        const crypto = yield* Crypto.Crypto
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const created = yield* Ref.make<VitestRuntime | undefined>(undefined)
        const build = buildRuntime(input, created, { crypto, fileSystem: fs, path })
        const closeCurrent = closeOnShutdown(created)
        const decodedOptions = yield* Effect.cached(decodeOptions(input.options))
        const runtime = yield* Effect.cached(Effect.flatMap(decodedOptions, build))
        const write = <A>(f: (self: VitestRuntime) => A) =>
          Effect.flatMap(runtime, (self) => Effect.sync(() => f(self)))
        yield* Effect.addFinalizer(() => closeCurrent.pipe(Effect.ignore))
        return VitestSession.of(assembleShape(decodedOptions, runtime, write, closeCurrent, fs))
      }),
    )
}
const assembleShape = (
  options: Effect.Effect<VitestRunnerOptions, TestRunnerFailed>,
  runtime: Effect.Effect<VitestRuntime, TestRunnerFailed>,
  write: <A>(f: (self: VitestRuntime) => A) => Effect.Effect<A, TestRunnerFailed>,
  closeCurrent: Effect.Effect<void, TestRunnerFailed, FileSystem.FileSystem>,
  fs: FileSystem.FileSystem,
): VitestSessionShape => ({
  options,
  runtime,
  setMode: (mode) => write((self) => setMode(self, mode)),
  provide: (key, value) => write((self) => provideValue(self, key, value)),
  close: closeCurrent.pipe(Effect.provideService(FileSystem.FileSystem, fs)),
})
const closeOnShutdown = (created: Ref.Ref<VitestRuntime | undefined>) =>
  Effect.flatMap(Ref.get(created), (self) =>
    Option.match(Option.fromNullishOr(self), { onNone: () => Effect.void, onSome: close }))
const buildRuntime = (
  input: VitestSessionInput,
  created: Ref.Ref<VitestRuntime | undefined>,
  platform: { readonly crypto: Crypto.Crypto; readonly fileSystem: FileSystem.FileSystem; readonly path: Path.Path },
) => (vitestOptions: VitestRunnerOptions): Effect.Effect<VitestRuntime, TestRunnerFailed> =>
  create({
    projectRoot: input.sandboxDirectory,
    namespace: namespaceOf(input),
    bail: bailOf(input),
    setupFilePath: input.setupFilePath,
    resolver: input.resolveVitestFor ?? resolveVitest,
    vitestOptions,
    crypto: platform.crypto,
    fileSystem: platform.fileSystem,
    path: platform.path,
  }).pipe(Effect.tap((self) => Ref.set(created, self)))
const bailOf = (input: VitestSessionInput): number =>
  Boolean.match(input.options.disableBail, { onTrue: () => 0, onFalse: () => 1 })
const namespaceOf = (input: VitestSessionInput): StrykerNamespace =>
  Option.getOrElse(Option.liftPredicate(input.globalNamespace, S.is(S.Literals(['__stryker__', '__stryker2__']))), () =>
    InstrumenterContext.NAMESPACE)
