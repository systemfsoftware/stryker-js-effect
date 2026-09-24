import { pathToFileURL } from 'node:url'

import * as Effect from 'effect/Effect'

import { projectForFile } from '../environments/file-config.js'
import { type ProvidedValue, readGlobalState } from '../global-state.js'
import { nativeImport } from '../native-import.js'
import type { VmGraphContext, VmPluginHost, VmSessionPlugin } from '../session-plugin.js'
import { GlobalSetupFailure } from './global-setup.schema.js'

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

const callableOf = (value: object, file: string, key: string): GlobalSetupFunction => {
  if (typeof value !== 'function') {
    throw new Error(`invalid export in globalSetup file ${file}: ${key} must be a function`)
  }
  return value as GlobalSetupFunction
}

const setupFileOf = (namespace: GlobalSetupNamespace, file: string): GlobalSetupFile => {
  const defaultFn = (namespace.default ?? undefined) === undefined
    ? undefined
    : callableOf(namespace.default as object, file, 'default')
  const setupFn = (namespace.setup ?? undefined) === undefined
    ? undefined
    : callableOf(namespace.setup as object, file, 'setup')
  const teardownFn = (namespace.teardown ?? undefined) === undefined
    ? undefined
    : (callableOf(namespace.teardown as object, file, 'teardown') as Teardown)
  if (defaultFn !== undefined) {
    return { file, setup: defaultFn, teardown: undefined }
  }
  if (setupFn !== undefined || teardownFn !== undefined) {
    return { file, setup: setupFn, teardown: teardownFn }
  }
  throw new Error(`invalid globalSetup file ${file}. Must export setup, teardown or have a default export`)
}
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

const teardownOf = (file: GlobalSetupFile, returned: object | null | undefined): Teardown | undefined => {
  if (returned === undefined || returned === null) return undefined
  if (file.teardown !== undefined) return undefined
  if (typeof returned !== 'function') {
    throw new TypeError(`invalid return value in globalSetup file ${file.file}. Must return a function`)
  }
  return returned as Teardown
}

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

const setupProjectsOf = (host: VmPluginHost, graph: VmGraphContext): ReadonlyArray<ProjectGlobalSetup> => {
  const projects: Array<ProjectGlobalSetup> = []
  const seen = new Set<string>()
  for (const file of graph.files) {
    const project = projectForFile(host, file)
    if (seen.has(project.name)) continue
    seen.add(project.name)
    const entries = project.globalSetup ?? []
    if (entries.length > 0) projects.push({ name: project.name, entries })
  }
  return projects
}

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
      const collected: Array<Teardown> = []
      for (const entry of project.entries) {
        const file = yield* loadSetupFile(host, entry)
        const teardown = yield* callSetup(file, context)
        if (teardown !== undefined) collected.push(teardown)
      }
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
      const provided = providedByProject[projectForFile(host, file.file).name]
      if (provided === undefined) return
      const names = Object.keys(provided)
      if (names.length === 0) return
      const state = readGlobalState()
      if (state === undefined) return
      for (const name of names) {
        const value = provided[name]
        if (value !== undefined) state.provided[name] = value
      }
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
