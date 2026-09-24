import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Config, Effect, FileSystem, Layer, Option, Path } from 'effect'

import type { TestRegistry } from '../../core/registry.js'
import { defaultSnapshotPath, snapshotUpdateMode } from '../../core/snapshot-paths.js'
import { currentSnapshotTest, setSnapshotTest, type SnapshotTest } from '../../core/snapshot-test.js'
import type { VmRunKind } from '../../core/vm-protocol.schema.js'
import type { VmPluginHost } from '../session-plugin.js'
import { VM_VITEST_BAG_KEY, type VmVitestRuntime } from '../vitest-host/runtime.js'
import {
  type FormatConfig,
  type PluginPrinter,
  type SerializerPlugin,
  setWorkerTestFile,
  type SnapshotClientLike,
  snapshotClientOf,
  type SnapshotFormatLike,
  type SnapshotStateOptionsLike,
} from './snapshot-api.js'
import { createSnapshotEnvironment } from './snapshot-environment.js'

export interface SnapshotSupport {
  readonly openFile: (file: string) => Promise<void>
  readonly beginTest: (test: SnapshotTest, runKind: VmRunKind) => void
  readonly endTest: () => void
  readonly closeFile: (file: string) => Promise<void>
  readonly closeAll: () => Promise<void>
}

export interface SnapshotSupportOptions {
  readonly ci?: string | undefined
}

interface ExpectWithSerializers {
  addSnapshotSerializer?: (serializer: SerializerPlugin) => void
}
interface SerializerModule {
  readonly default?: SerializerPlugin
  readonly test?: (value: object) => boolean
  readonly serialize?: (
    value: object,
    config: FormatConfig,
    indentation: string,
    depth: number,
    refs: ReadonlyArray<object>,
    printer: PluginPrinter,
  ) => string
  readonly print?: (
    value: object,
    serialize: (value: object) => string,
    indent: (value: string) => string,
  ) => string
}

const moduleAsPlugin = (module: SerializerModule): SerializerPlugin => {
  const candidate = module.default ?? module
  const test = 'test' in candidate && typeof candidate.test === 'function' ? candidate.test : undefined
  const serialize = 'serialize' in candidate && typeof candidate.serialize === 'function'
    ? candidate.serialize
    : undefined
  const print = 'print' in candidate && typeof candidate.print === 'function' ? candidate.print : undefined
  if (test === undefined || (serialize === undefined && print === undefined)) {
    throw new Error('the snapshot serializer module exports neither a default nor test/serialize')
  }
  if (serialize !== undefined) {
    return { test, serialize }
  }
  if (print !== undefined) {
    return { test, print }
  }
  throw new Error('the snapshot serializer module exports neither a default nor test/serialize')
}

interface RecordedSerializer {
  readonly plugin: SerializerPlugin
  file: string | undefined
}

interface VmProjectConfigLike {
  readonly name: string
  readonly snapshotFormat: SnapshotFormatLike
  readonly snapshotSerializers: ReadonlyArray<string>
}

const platformLayers = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const ciOf = (): string | undefined => Option.getOrUndefined(Effect.runSync(Effect.option(Config.String('CI'))))

const realmExpectOf = (host: VmPluginHost): ExpectWithSerializers | undefined => {
  try {
    return host.resolveVitest().expect
  } catch {
    return undefined
  }
}

const recordedSerializers: Array<RecordedSerializer> = []
const hijackedExpects = new WeakSet<object>()
const projectSerializerCache = new Map<string, ReadonlyArray<SerializerPlugin>>()
let drainWindowFile: string | undefined
let activeRegistry: TestRegistry | undefined

export const setSnapshotDrainWindow = (file: string | undefined): void => {
  drainWindowFile = file
}

export const setSnapshotRegistry = (registry: TestRegistry): void => {
  activeRegistry = registry
}

const attributedFileOf = (): string | undefined => {
  if (drainWindowFile !== undefined) return drainWindowFile
  const current = activeRegistry?.files.current
  return typeof current === 'string' && current.length > 0 ? current : undefined
}

const gatedSerializerOf = (plugin: SerializerPlugin, record: RecordedSerializer): SerializerPlugin => {
  const test = (value: object): boolean => {
    if (currentSnapshotTest()?.file !== record.file) return false
    return plugin.test(value)
  }
  return 'serialize' in plugin && typeof plugin.serialize === 'function'
    ? { test, serialize: plugin.serialize }
    : { test, print: plugin.print }
}

const hijackExpect = (expectApi: ExpectWithSerializers): void => {
  if (hijackedExpects.has(expectApi)) return
  const realmAdd = expectApi.addSnapshotSerializer
  if (typeof realmAdd !== 'function') return
  hijackedExpects.add(expectApi)
  expectApi.addSnapshotSerializer = (plugin: SerializerPlugin): void => {
    const record: RecordedSerializer = { plugin, file: attributedFileOf() }
    recordedSerializers.push(record)
    Reflect.apply(realmAdd, expectApi, [gatedSerializerOf(plugin, record)])
  }
}

const ensureSerializerScope = (host: VmPluginHost): void => {
  const realmExpect = realmExpectOf(host)
  if (realmExpect !== undefined) hijackExpect(realmExpect)
}

const flushPendingSerializers = (testFile: string): void => {
  for (const record of recordedSerializers) {
    if (record.file === undefined) record.file = testFile
  }
}

const projectSerializerSerializersOf = (
  project: VmProjectConfigLike | undefined,
): ReadonlyArray<SerializerPlugin> => (project === undefined ? [] : projectSerializerCache.get(project.name) ?? [])

const serializerScopeFor = (
  testFile: string,
  project: VmProjectConfigLike | undefined,
): SnapshotFormatLike | undefined => {
  const fromProject = projectSerializerSerializersOf(project)
  void testFile
  if (fromProject.length === 0) return undefined
  const declared = project?.snapshotFormat['plugins']
  return {
    ...project?.snapshotFormat,
    plugins: Array.isArray(declared) && declared.length > 0 ? declared : fromProject,
  }
}

const serializerEntryOf = (
  host: VmPluginHost,
  runtime: VmVitestRuntime | undefined,
  specifier: string,
  testFile: string,
  path: Path.Path,
): string => {
  const fromVite = runtime?.resolveIdSync(specifier, testFile)
  if (fromVite !== undefined) {
    return fromVite
  }
  return createRequire(path.join(host.sandboxWorkingDirectory, 'package.json')).resolve(specifier)
}

const makeSnapshotSupport = (
  host: VmPluginHost,
  options: SnapshotSupportOptions | undefined,
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
): SnapshotSupport => {
  const clients = new Map<string, SnapshotClientLike>()
  const clientFor = (file: string): SnapshotClientLike => {
    const existing = clients.get(file)
    if (existing !== undefined) return existing
    const created = snapshotClientOf()
    clients.set(file, created)
    return created
  }
  const environment = createSnapshotEnvironment({
    fileSystem,
    path,
    snapshotPathFor: (testFile) =>
      host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)?.resolveSnapshotPathSync(testFile) ??
        defaultSnapshotPath(path, testFile),
  })
  const openFiles = new Set<string>()
  let runKind: VmRunKind = 'mutant'
  ensureSerializerScope(host)

  const projectFor = (testFile: string): VmProjectConfigLike | undefined => {
    const project = host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)?.projectFor(testFile)
    return project === undefined
      ? undefined
      : {
        name: project.name,
        snapshotFormat: project.snapshotFormat,
        snapshotSerializers: project.snapshotSerializers,
      }
  }

  const optionsFor = (testFile: string): SnapshotStateOptionsLike => {
    const project = projectFor(testFile)
    return {
      updateSnapshot: snapshotUpdateMode(options?.ci ?? ciOf()),
      snapshotEnvironment: environment,
      snapshotFormat: serializerScopeFor(testFile, project) ?? project?.snapshotFormat ?? {},
    }
  }

  const ensureSerializers = (testFile: string): Promise<void> => {
    const project = projectFor(testFile)
    if (project === undefined || projectSerializerCache.has(project.name)) {
      return Promise.resolve()
    }
    const runtime = host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)
    return project.snapshotSerializers.reduce<Promise<ReadonlyArray<SerializerPlugin>>>(
      (loaded, specifier) =>
        loaded.then((plugins) =>
          import(pathToFileURL(serializerEntryOf(host, runtime, specifier, testFile, path)).href).then(
            (serializerModule: SerializerModule): ReadonlyArray<SerializerPlugin> => [
              ...plugins,
              moduleAsPlugin(serializerModule),
            ],
          )
        ),
      Promise.resolve<ReadonlyArray<SerializerPlugin>>([]),
    ).then((plugins) => {
      projectSerializerCache.set(project.name, plugins)
    })
  }
  const fileSetups = new Map<string, Promise<void>>()
  const openStates = new Map<string, SnapshotStateOptionsLike>()

  const optionsEqual = (first: SnapshotStateOptionsLike, second: SnapshotStateOptionsLike): boolean =>
    first.updateSnapshot === second.updateSnapshot &&
    first.snapshotEnvironment === second.snapshotEnvironment &&
    first.snapshotFormat === second.snapshotFormat

  const openFile = (file: string): Promise<void> => {
    const settled = openStates.get(file)
    if (settled !== undefined && optionsEqual(settled, optionsFor(file)) && openFiles.has(file)) {
      return Promise.resolve()
    }
    const inFlight = fileSetups.get(file)
    if (inFlight !== undefined) return inFlight
    const created = Promise.resolve()
      .then(() => {
        ensureSerializerScope(host)
        flushPendingSerializers(file)
      })
      .then(() => ensureSerializers(file))
      .then(() => {
        const snapshotOptions = optionsFor(file)
        openStates.set(file, snapshotOptions)
        openFiles.delete(file)
        return clientFor(file).setup(file, snapshotOptions).then(() => {
          openFiles.add(file)
        })
      })
    fileSetups.set(file, created)
    return created
  }

  const beginTest = (test: SnapshotTest, kind: VmRunKind): void => {
    runKind = kind
    clientFor(test.file).clearTest(test.file, test.id)
    setWorkerTestFile(test.file)
    setSnapshotTest(test)
  }

  const endTest = (): void => {
    setSnapshotTest(undefined)
  }

  const closeFile = (file: string): Promise<void> => {
    fileSetups.delete(file)
    if (!openFiles.has(file)) {
      return Promise.resolve()
    }
    openFiles.delete(file)
    if (runKind === 'dry') {
      return clientFor(file).finish(file).then(() => undefined)
    }
    return Promise.resolve()
  }

  const closeAll = (): Promise<void> => {
    const files = [...openFiles]
    return files.reduce((closed, file) => closed.then(() => closeFile(file)), Promise.resolve())
  }

  return { openFile, beginTest, endTest, closeFile, closeAll }
}

export const createSnapshotSupport = (
  host: VmPluginHost,
  options?: SnapshotSupportOptions,
): Promise<SnapshotSupport> =>
  Effect.runPromise(
    Effect.map(
      Effect.all([FileSystem.FileSystem, Path.Path]),
      ([fileSystem, path]) => makeSnapshotSupport(host, options, fileSystem, path),
    ).pipe(Effect.provide(platformLayers)),
  )
