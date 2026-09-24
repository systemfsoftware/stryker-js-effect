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

const instanceOf = (
  before: DescriptorMap,
  outcome: EnvironmentReturn | undefined,
  target: GlobalTarget,
): EnvironmentInstance => {
  const after = captureDescriptors(target)
  const installed = installedDescriptors(before, after)
  const teardown = outcome?.teardown
  return {
    installed,
    originals: priorDescriptors(before, installed),
    teardown: teardown === undefined
      ? Effect.void
      : Effect.tryPromise({
        try: () => Promise.resolve().then(() => teardown(target)).then(() => undefined),
        catch: (cause) =>
          new EnvironmentSetupFailure({ message: 'the test environment could not be torn down', cause }),
      }),
  }
}

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
      const dependency = environmentDependency(spec)
      if (dependency !== undefined && isMissingEnvironmentModule(caught, dependency)) {
        return new EnvironmentSetupFailure({ message: missingEnvironmentDependencyMessage(dependency), cause: caught })
      }
      return new EnvironmentSetupFailure({ message: 'the test environment could not be set up', cause: caught })
    },
  })

export const createEnvironmentActivation = (source: EnvironmentModuleSource): EnvironmentActivation => {
  const instances = new Map<string, EnvironmentInstance>()
  let activeKey: string | undefined

  const restoreActive = (): void => {
    if (activeKey === undefined) return
    const active = instances.get(activeKey)
    if (active !== undefined) restoreDescriptors(source.target, active.originals)
    activeKey = undefined
  }
  return {
    activate: (spec, options) => {
      const key = instanceKeyOf(spec, options)
      if (activeKey === key) return Effect.void
      if (activeKey !== undefined) restoreActive()
      if (isNodeEnvironment(spec)) return Effect.void
      const existing = instances.get(key)
      const instance = existing !== undefined ? Effect.succeed(existing) : createInstance(source, spec, options)
      return Effect.map(instance, (created) => {
        if (existing === undefined) instances.set(key, created)
        installDescriptors(source.target, created.installed)
        activeKey = key
      })
    },
    deactivate: () => restoreActive(),
    installedKeys: () => {
      const active = activeKey === undefined ? undefined : instances.get(activeKey)
      return new Set(active === undefined ? [] : active.installed.keys())
    },
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
