import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import {
  environmentDependency,
  isMissingEnvironmentModule,
  missingEnvironmentDependencyMessage,
} from './environment-failure.js'
import { EnvironmentSetupFailure } from './environment-failure.schema.js'
import {
  captureDescriptors,
  type DescriptorMap,
  type GlobalTarget,
  installDescriptors,
  installedDescriptors,
  type PriorDescriptors,
  priorDescriptors,
  restoreDescriptors,
} from './global-descriptors.js'
import type { EnvironmentSpec, FileEnvironment, PackageEnvironment } from './resolve-environment.workflow.js'
import type { EnvironmentReturn, VitestEnvironment } from './vitest-runtime-modules.js'
import type { VmJson } from './vm-json.js'

type AnyDecoded<A = unknown> = A

export interface EnvironmentModuleSource {
  readonly builtin: (name: string) => Promise<VitestEnvironment | undefined>
  readonly module: (spec: FileEnvironment | PackageEnvironment) => Promise<VitestEnvironment>
  readonly target: GlobalTarget
}

interface EnvironmentInstance {
  readonly installed: DescriptorMap
  readonly originals: PriorDescriptors
  readonly teardown: Effect.Effect<void, EnvironmentSetupFailure>
}

export const ENVIRONMENT_KEYS_BAG_KEY = 'vitest:env-keys'

export interface EnvironmentActivation {
  readonly activate: (
    spec: EnvironmentSpec,
    options: Record<string, VmJson>,
  ) => Effect.Effect<void, EnvironmentSetupFailure>
  readonly deactivate: () => void
  readonly dispose: Effect.Effect<void, EnvironmentSetupFailure>
  readonly installedKeys: () => ReadonlySet<string>
}

const isNodeEnvironment = (spec: EnvironmentSpec): boolean =>
  Match.value(spec).pipe(
    Match.tag('NodeEnvironment', () => true),
    Match.tag('BuiltinEnvironment', () => false),
    Match.tag('FileEnvironment', () => false),
    Match.tag('PackageEnvironment', () => false),
    Match.exhaustive,
  )

const instanceKeyOf = (spec: EnvironmentSpec, options: Record<string, VmJson>): string =>
  `${
    Match.value(spec).pipe(
      Match.tag('NodeEnvironment', () => 'node'),
      Match.tag('BuiltinEnvironment', (builtin) => `builtin:${builtin.name}`),
      Match.tag('FileEnvironment', (file) => `file:${file.path}`),
      Match.tag('PackageEnvironment', (custom) => `package:${custom.dependency}`),
      Match.exhaustive,
    )
  }\u0000${JSON.stringify(options)}`

const environmentPromiseFor = (source: EnvironmentModuleSource, spec: EnvironmentSpec): Promise<VitestEnvironment> =>
  Match.value(spec).pipe(
    Match.tag(
      'BuiltinEnvironment',
      (builtin) =>
        source.builtin(builtin.name).then((environment) =>
          Option.match(Option.fromNullishOr(environment), {
            onNone: () => {
              throw new Error(`vitest/runtime does not serve a "${builtin.name}" environment`)
            },
            onSome: (served) => served,
          })
        ),
    ),
    Match.tag('FileEnvironment', (file) => source.module(file)),
    Match.tag('PackageEnvironment', (custom) => source.module(custom)),
    Match.tag('NodeEnvironment', () => Promise.reject(new Error('the node environment needs no activation'))),
    Match.exhaustive,
  )

const runTeardown = (
  teardown: (target: GlobalTarget) => void | Promise<void>,
  target: GlobalTarget,
): Effect.Effect<void, EnvironmentSetupFailure> =>
  Effect.tryPromise({
    try: () => Promise.resolve().then(() => teardown(target)).then(() => undefined),
    catch: (cause) => new EnvironmentSetupFailure({ message: 'the test environment could not be torn down', cause }),
  })

const teardownOf = (
  outcome: EnvironmentReturn | undefined,
  target: GlobalTarget,
): Effect.Effect<void, EnvironmentSetupFailure> =>
  Match.value(outcome?.teardown).pipe(
    Match.when(Match.undefined, () => Effect.void),
    Match.orElse((teardown) => runTeardown(teardown, target)),
  )

const instanceOf = (
  before: DescriptorMap,
  outcome: EnvironmentReturn | undefined,
  target: GlobalTarget,
): EnvironmentInstance => {
  const after = captureDescriptors(target)
  const installed = installedDescriptors(before, after)
  return {
    installed,
    originals: priorDescriptors(before, installed),
    teardown: teardownOf(outcome, target),
  }
}

const environmentSetupFailure = (message: string, caught: AnyDecoded): EnvironmentSetupFailure =>
  new EnvironmentSetupFailure({ message, cause: caught })

const createInstance = (
  source: EnvironmentModuleSource,
  spec: EnvironmentSpec,
  options: Record<string, VmJson>,
): Effect.Effect<EnvironmentInstance, EnvironmentSetupFailure> =>
  Effect.tryPromise({
    try: () =>
      environmentPromiseFor(source, spec).then((environment) => {
        const before = captureDescriptors(source.target)
        return environment.setup(source.target, options).then((outcome) => instanceOf(before, outcome, source.target))
      }),
    catch: (caught) => {
      const dependency = Option.fromUndefinedOr(environmentDependency(spec))
      return Match.value(Option.exists(dependency, (present) => isMissingEnvironmentModule(caught, present))).pipe(
        Match.when(true, () =>
          environmentSetupFailure(
            Option.match(dependency, {
              onNone: () => 'the test environment could not be set up',
              onSome: missingEnvironmentDependencyMessage,
            }),
            caught,
          )),
        Match.when(false, () => environmentSetupFailure('the test environment could not be set up', caught)),
        Match.exhaustive,
      )
    },
  })

export const createEnvironmentActivation = (source: EnvironmentModuleSource): EnvironmentActivation => {
  const instances = new Map<string, EnvironmentInstance>()
  let activeKey: string | undefined

  const activeInstance = (): EnvironmentInstance | undefined =>
    Option.getOrUndefined(
      Option.flatMap(Option.fromUndefinedOr(activeKey), (key) => Option.fromUndefinedOr(instances.get(key))),
    )

  const restoreActive = (): void => {
    const active = activeInstance()
    if (active !== undefined) restoreDescriptors(source.target, active.originals)
    activeKey = undefined
  }

  const instanceFor = (
    key: string,
    spec: EnvironmentSpec,
    options: Record<string, VmJson>,
  ): Effect.Effect<EnvironmentInstance, EnvironmentSetupFailure> =>
    Match.value(instances.get(key)).pipe(
      Match.when(Match.undefined, () => createInstance(source, spec, options)),
      Match.orElse((existing) => Effect.succeed(existing)),
    )

  const activateResolved = (
    key: string,
    spec: EnvironmentSpec,
    options: Record<string, VmJson>,
  ): Effect.Effect<void, EnvironmentSetupFailure> =>
    Effect.map(instanceFor(key, spec, options), (created) => {
      instances.set(key, created)
      installDescriptors(source.target, created.installed)
      activeKey = key
    })

  const activateKey = (
    key: string,
    spec: EnvironmentSpec,
    options: Record<string, VmJson>,
  ): Effect.Effect<void, EnvironmentSetupFailure> =>
    Match.value(isNodeEnvironment(spec)).pipe(
      Match.when(true, () => Effect.void),
      Match.when(false, () => activateResolved(key, spec, options)),
      Match.exhaustive,
    )

  const activate = (
    spec: EnvironmentSpec,
    options: Record<string, VmJson>,
  ): Effect.Effect<void, EnvironmentSetupFailure> => {
    const key = instanceKeyOf(spec, options)
    if (activeKey === key) return Effect.void
    restoreActive()
    return activateKey(key, spec, options)
  }

  const installedKeys = (): ReadonlySet<string> => {
    const active = activeInstance()
    return new Set(active === undefined ? [] : active.installed.keys())
  }

  return {
    activate,
    deactivate: () => restoreActive(),
    installedKeys,
    dispose: Effect.sync(() => {
      restoreActive()
      return [...instances.values()]
    }).pipe(
      Effect.flatMap((live) => {
        instances.clear()
        return Effect.forEach(live, (instance) => instance.teardown, { concurrency: 1, discard: true })
      }),
    ),
  }
}
