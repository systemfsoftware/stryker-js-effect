import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import type * as Path from 'effect/Path'
import { createRequire } from 'node:module'

import * as Result from 'effect/Result'
import {
  createEnvironmentActivation,
  ENVIRONMENT_KEYS_BAG_KEY,
  type EnvironmentActivation,
} from '../environments/environment-activation.js'
import type { EnvironmentSetupFailure } from '../environments/environment-failure.schema.js'
import { pathOf, projectForFile } from '../environments/file-config.js'
import {
  type EnvironmentSpec,
  resolveEnvironment,
  ResolveEnvironmentCommand,
} from '../environments/resolve-environment.workflow.js'
import {
  loadModuleEnvironment,
  loadVitestRuntimeModules,
  type VitestRuntimeModules,
} from '../environments/vitest-runtime-modules.js'
import type { VmFileContext, VmGraphContext, VmPluginHost, VmSessionPlugin } from '../session-plugin.js'
import type { VmProjectConfig } from '../vitest-host/runtime.js'

const PLUGIN_NAME = 'environment'

interface SessionState {
  readonly path: Path.Path
  readonly runtimeModules: () => Promise<VitestRuntimeModules>
}

const sessionStates = new WeakMap<VmPluginHost, SessionState>()
const activations = new WeakMap<VmPluginHost, EnvironmentActivation>()

const stateFor = (host: VmPluginHost): SessionState => {
  const existing = sessionStates.get(host)
  if (existing !== undefined) return existing
  const path = pathOf(host)
  let modules: Promise<VitestRuntimeModules> | undefined
  const created: SessionState = {
    path,
    runtimeModules: () => {
      modules ??= loadVitestRuntimeModules(
        createRequire(host.resolveVitestModule('vitest/package.json')).resolve('vitest/runtime'),
        path,
      )
      return modules
    },
  }
  sessionStates.set(host, created)
  return created
}

const activationFor = (host: VmPluginHost): EnvironmentActivation => {
  const existing = activations.get(host)
  if (existing !== undefined) return existing
  const state = stateFor(host)
  const created = createEnvironmentActivation({
    builtin: (name) => state.runtimeModules().then((modules) => modules.builtinEnvironments[name]),
    module: (spec) => loadModuleEnvironment(spec, host.sandboxWorkingDirectory, state.path),
    target: globalThis,
  })
  activations.set(host, created)
  return created
}

const specOfProject = (project: VmProjectConfig): EnvironmentSpec =>
  Result.getOrThrow(
    resolveEnvironment(ResolveEnvironmentCommand.make({ name: project.environment, root: project.root })),
  )

const activateSpec = (
  host: VmPluginHost,
  spec: EnvironmentSpec,
  options: VmProjectConfig['environmentOptions'],
): Effect.Effect<void, EnvironmentSetupFailure> =>
  Match.value(spec).pipe(
    Match.tag('NodeEnvironment', () => Effect.void),
    Match.tag('BuiltinEnvironment', (builtin) => activationFor(host).activate(builtin, options)),
    Match.tag('FileEnvironment', (file) => activationFor(host).activate(file, options)),
    Match.tag('PackageEnvironment', (custom) => activationFor(host).activate(custom, options)),
    Match.exhaustive,
  )

const activateFor = (host: VmPluginHost, file: VmFileContext): Effect.Effect<void, EnvironmentSetupFailure> => {
  const project = projectForFile(host, file.file)
  return activateSpec(host, specOfProject(project), project.environmentOptions)
}

const publishKeys = (host: VmPluginHost): void => {
  host.state.write(ENVIRONMENT_KEYS_BAG_KEY, { keys: activationFor(host).installedKeys() })
}

const deactivateExisting = (host: VmPluginHost): void => {
  activations.get(host)?.deactivate()
  publishKeys(host)
}

export const environmentPlugin: VmSessionPlugin = {
  name: PLUGIN_NAME,
  beforeFileImport: (file, host) =>
    Effect.runPromise(
      activateFor(host, file).pipe(Effect.tap((): Effect.Effect<void> => Effect.sync(() => publishKeys(host)))),
    ),
  afterFileImport: (_file, host) => {
    deactivateExisting(host)
  },
  beforeFileRun: (file, host) =>
    Effect.runPromise(
      activateFor(host, file).pipe(Effect.tap((): Effect.Effect<void> => Effect.sync(() => publishKeys(host)))),
    ),
  afterFileRun: (_file, host) => {
    deactivateExisting(host)
  },
  disposeGraph: (_graph: VmGraphContext, host: VmPluginHost) => {
    const activation = activations.get(host)
    return activation === undefined ? Promise.resolve() : Effect.runPromise(activation.dispose)
  },
}
