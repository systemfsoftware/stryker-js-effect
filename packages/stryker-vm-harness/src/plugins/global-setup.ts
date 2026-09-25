import * as Effect from 'effect/Effect'

import { projectForFile } from '../environments/file-config.js'
import { nativeImport } from '../native-import.js'
import { type ProvidedValue, readGlobalState } from '../sandbox-state.handle.js'
import type { VmRunnerGlobalState } from '../sandbox.schema.js'
import type { VmGraphContext, VmPluginHost, VmSessionPlugin } from '../session-plugin.js'
import type { VmProjectConfig } from '../vitest-host/runtime.js'
import { GlobalSetupFailure } from './global-setup.schema.js'

const urlBuiltin = globalThis.process.getBuiltinModule('node:url')
const { pathToFileURL } = urlBuiltin

type AnyDecoded<A = unknown> = A

const PLUGIN_NAME = 'global-setup'

export interface GlobalSetupContext {
  readonly provide: (key: string, value: ProvidedValue) => void
}

type GlobalSetupFunction = (context: GlobalSetupContext) => object | null | undefined
type Teardown = () => object | null | undefined

interface GlobalSetupNamespace {
  readonly default?: object | null | undefined
  readonly setup?: object | null | undefined
  readonly teardown?: object | null | undefined
}

interface GlobalSetupFile {
  readonly file: string
  readonly setup: GlobalSetupFunction | undefined
  readonly teardown: Teardown | undefined
}

interface ProjectGlobalSetup {
  readonly name: string
  readonly entries: ReadonlyArray<string>
}

const isNullish = (value: AnyDecoded): boolean => value === undefined || value === null

const isGlobalSetupFunction = (value: AnyDecoded): value is GlobalSetupFunction => typeof value === 'function'

const isTeardown = (value: AnyDecoded): value is Teardown => typeof value === 'function'

const callableOf = (value: AnyDecoded, file: string, key: string): GlobalSetupFunction => {
  if (!isGlobalSetupFunction(value)) {
    throw new Error(`invalid export in globalSetup file ${file}: ${key} must be a function`)
  }
  return value
}

const optionalCallableOf = (
  value: AnyDecoded,
  file: string,
  key: string,
): GlobalSetupFunction | undefined => isNullish(value) ? undefined : callableOf(value, file, key)

const teardownValueOf = (file: string, value: AnyDecoded): Teardown => {
  if (!isTeardown(value)) {
    throw new Error(`invalid export in globalSetup file ${file}: teardown must be a function`)
  }
  return value
}

const optionalTeardownOf = (value: AnyDecoded, file: string): Teardown | undefined =>
  isNullish(value) ? undefined : teardownValueOf(file, value)

const hasSetupOrTeardown = (
  setupFn: GlobalSetupFunction | undefined,
  teardownFn: Teardown | undefined,
): boolean => setupFn !== undefined || teardownFn !== undefined

const missingSetupError = (file: string): never => {
  throw new Error(`invalid globalSetup file ${file}. Must export setup, teardown or have a default export`)
}

const setupFileFor = (
  file: string,
  setupFn: GlobalSetupFunction | undefined,
  teardownFn: Teardown | undefined,
): GlobalSetupFile =>
  hasSetupOrTeardown(setupFn, teardownFn)
    ? { file, setup: setupFn, teardown: teardownFn }
    : missingSetupError(file)

const resolveSetupFile = (
  file: string,
  defaultFn: GlobalSetupFunction | undefined,
  setupFn: GlobalSetupFunction | undefined,
  teardownFn: Teardown | undefined,
): GlobalSetupFile =>
  defaultFn === undefined
    ? setupFileFor(file, setupFn, teardownFn)
    : { file, setup: defaultFn, teardown: undefined }

const setupFileOf = (namespace: GlobalSetupNamespace, file: string): GlobalSetupFile =>
  resolveSetupFile(
    file,
    optionalCallableOf(namespace.default, file, 'default'),
    optionalCallableOf(namespace.setup, file, 'setup'),
    optionalTeardownOf(namespace.teardown, file),
  )

const taggedFailureOf = <A>(fallback: string, caught: A): GlobalSetupFailure =>
  caught instanceof Error
    ? new GlobalSetupFailure({ message: caught.message, cause: caught })
    : new GlobalSetupFailure({ message: fallback, cause: caught })

const globalSetupSaltOf = (entry: string): string => `global-setup:${entry}`

const fileUrlForSalted = (entry: string): string =>
  `${pathToFileURL(entry).href}?salt=${encodeURIComponent(globalSetupSaltOf(entry))}`

const loadSetupFile = (host: VmPluginHost, entry: string): Effect.Effect<GlobalSetupFile, GlobalSetupFailure> =>
  Effect.tryPromise({
    try: () =>
      host.importFile(entry, globalSetupSaltOf(entry)).then(() =>
        nativeImport<GlobalSetupNamespace>(fileUrlForSalted(entry))
      ).then((namespace) => setupFileOf(namespace, entry)),
    catch: (caught) => taggedFailureOf(`the global setup file ${entry} could not be loaded`, caught),
  })

const teardownValueFrom = (file: string, returned: AnyDecoded): Teardown => {
  if (!isTeardown(returned)) {
    throw new TypeError(`invalid return value in globalSetup file ${file}. Must return a function`)
  }
  return returned
}

const requiredTeardownOf = (file: GlobalSetupFile, returned: AnyDecoded): Teardown | undefined =>
  file.teardown === undefined ? teardownValueFrom(file.file, returned) : undefined

const teardownOf = (file: GlobalSetupFile, returned: AnyDecoded): Teardown | undefined =>
  isNullish(returned) ? undefined : requiredTeardownOf(file, returned)

const callSetup = (
  file: GlobalSetupFile,
  context: GlobalSetupContext,
): Effect.Effect<Teardown | undefined, GlobalSetupFailure> =>
  Effect.tryPromise({
    try: () =>
      Promise.resolve(file.setup === undefined ? undefined : file.setup(context)).then((returned) =>
        teardownOf(file, returned)
      ),
    catch: (caught) => taggedFailureOf(`the global setup file ${file.file} could not be set up`, caught),
  })

const globalSetupEntriesOf = (project: VmProjectConfig): ReadonlyArray<string> => project.globalSetup ?? []

const projectGlobalSetupOf = (project: VmProjectConfig): ProjectGlobalSetup | undefined =>
  globalSetupEntriesOf(project).length > 0
    ? { name: project.name, entries: globalSetupEntriesOf(project) }
    : undefined

const setupProjectEntryOf = (
  host: VmPluginHost,
  seen: Set<string>,
  file: string,
): ProjectGlobalSetup | undefined => {
  const project = projectForFile(host, file)
  if (seen.has(project.name)) return undefined
  seen.add(project.name)
  return projectGlobalSetupOf(project)
}

const setupProjectsOf = (host: VmPluginHost, graph: VmGraphContext): ReadonlyArray<ProjectGlobalSetup> => {
  const seen = new Set<string>()
  return graph.files.flatMap((file) => {
    const setup = setupProjectEntryOf(host, seen, file)
    return setup === undefined ? [] : [setup]
  })
}

const teardownEntryOf = (
  host: VmPluginHost,
  entry: string,
  context: GlobalSetupContext,
): Effect.Effect<ReadonlyArray<Teardown>, GlobalSetupFailure> =>
  Effect.gen(function*() {
    const file = yield* loadSetupFile(host, entry)
    const teardown = yield* callSetup(file, context)
    return teardown === undefined ? [] : [teardown]
  })

const collectTeardowns = (
  entries: ReadonlyArray<string>,
  host: VmPluginHost,
  context: GlobalSetupContext,
): Effect.Effect<ReadonlyArray<Teardown>, GlobalSetupFailure> =>
  Effect.gen(function*() {
    const collected: Array<Teardown> = []
    for (const entry of entries) {
      collected.push(...(yield* teardownEntryOf(host, entry, context)))
    }
    return collected
  })

const writeProvided = (state: VmRunnerGlobalState, name: string, value: ProvidedValue | undefined): void => {
  if (value !== undefined) state.provided[name] = value
}

const writeProvidedEntries = (state: VmRunnerGlobalState, provided: Record<string, ProvidedValue>): void => {
  for (const name of Object.keys(provided)) writeProvided(state, name, provided[name])
}

const providedIntoState = (provided: Record<string, ProvidedValue>): void => {
  const state = readGlobalState()
  if (state === undefined) return
  writeProvidedEntries(state, provided)
}

const isEmptyProvided = (provided: Record<string, ProvidedValue>): boolean => Object.keys(provided).length === 0

const isBlankProvided = (provided: Record<string, ProvidedValue> | undefined): boolean =>
  provided === undefined || isEmptyProvided(provided)

const usableProvided = (
  provided: Record<string, ProvidedValue> | undefined,
): Record<string, ProvidedValue> | undefined => isBlankProvided(provided) ? undefined : provided

export const createGlobalSetupPlugin = (): VmSessionPlugin => {
  let providedByProject: Record<string, Record<string, ProvidedValue> | undefined> = {}
  let teardowns: ReadonlyArray<Teardown> = []

  const runProject = (project: ProjectGlobalSetup, host: VmPluginHost) =>
    Effect.gen(function*() {
      let provided: Record<string, ProvidedValue> = {}
      const context: GlobalSetupContext = {
        provide: (key, value) => {
          provided = { ...provided, [key]: value }
        },
      }
      const collected = yield* collectTeardowns(project.entries, host, context)
      teardowns = [...teardowns, ...collected]
      providedByProject = { ...providedByProject, [project.name]: provided }
    })

  return {
    name: PLUGIN_NAME,
    beforeGraphLoad: (graph, host) => {
      const projects = setupProjectsOf(host, graph).filter(
        (project) => providedByProject[project.name] === undefined,
      )
      if (projects.length === 0) return Promise.resolve()
      return Effect.runPromise(
        Effect.forEach(projects, (project) => runProject(project, host), { concurrency: 1, discard: true }),
      )
    },
    beforeFileImport: (file, host) => {
      const provided = usableProvided(providedByProject[projectForFile(host, file.file).name])
      if (provided === undefined) return
      providedIntoState(provided)
    },
    dispose: () => {
      const ordered = [...teardowns].reverse()
      teardowns = []
      providedByProject = {}
      if (ordered.length === 0) return Promise.resolve()
      return Effect.runPromise(
        Effect.forEach(
          ordered,
          (teardown) =>
            Effect.tryPromise({
              try: () => Promise.resolve(teardown()).then(() => undefined),
              catch: (caught) => taggedFailureOf('a global setup teardown failed', caught),
            }),
          { concurrency: 1, discard: true },
        ),
      )
    },
  }
}
