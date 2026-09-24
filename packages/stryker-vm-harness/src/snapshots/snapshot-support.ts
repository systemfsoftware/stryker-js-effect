import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Config, Effect, FileSystem, Layer, Option, Path } from 'effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'

import type { TestRegistry } from '../registry.schema.js'
import type { VmPluginHost } from '../session-plugin.js'
import { defaultSnapshotPath, type SnapshotUpdateMode, snapshotUpdateMode } from '../snapshot-paths.js'
import { currentSnapshotTest, setSnapshotTest, type SnapshotTest } from '../snapshot-test.js'
import { VM_VITEST_BAG_KEY, type VmProjectConfig, type VmVitestRuntime } from '../vitest-host/runtime.js'
import type { VmRunKind } from '../vm-protocol.schema.js'
import {
  type FormatConfig,
  type PluginPrinter,
  type PrintSerializer,
  type SerializerPlugin,
  type SerializeSerializer,
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

type SerializerCandidate = object | SerializerModule

const nodeModule = globalThis.process.getBuiltinModule('node:module')
const nodeUrl = globalThis.process.getBuiltinModule('node:url')

const SERIALIZER_MODULE_ERROR = 'the snapshot serializer module exports neither a default nor test/serialize'

const isSerializerTest = (value: unknown): value is SerializerPlugin['test'] => typeof value === 'function'

const isSerializerSerialize = (value: unknown): value is SerializeSerializer['serialize'] => typeof value === 'function'

const isSerializerPrint = (value: unknown): value is PrintSerializer['print'] => typeof value === 'function'

const testFunctionOf = (candidate: SerializerCandidate): SerializerPlugin['test'] | undefined =>
  Option.getOrUndefined(Option.liftPredicate(isSerializerTest)(Reflect.get(candidate, 'test')))

const serializeFunctionOf = (candidate: SerializerCandidate): SerializeSerializer['serialize'] | undefined =>
  Option.getOrUndefined(Option.liftPredicate(isSerializerSerialize)(Reflect.get(candidate, 'serialize')))

const printFunctionOf = (candidate: SerializerCandidate): PrintSerializer['print'] | undefined =>
  Option.getOrUndefined(Option.liftPredicate(isSerializerPrint)(Reflect.get(candidate, 'print')))

const printPluginOf = (
  test: SerializerPlugin['test'],
  print: PrintSerializer['print'] | undefined,
): SerializerPlugin =>
  Match.value(print).pipe(
    Match.when(Match.undefined, () => {
      throw new Error(SERIALIZER_MODULE_ERROR)
    }),
    Match.orElse((presentPrint) => ({ test, print: presentPrint })),
  )

const serializePluginOf = (
  test: SerializerPlugin['test'],
  serialize: SerializeSerializer['serialize'] | undefined,
  print: PrintSerializer['print'] | undefined,
): SerializerPlugin =>
  Match.value(serialize).pipe(
    Match.when(Match.undefined, () => printPluginOf(test, print)),
    Match.orElse((presentSerialize) => ({ test, serialize: presentSerialize })),
  )

const moduleAsPlugin = (module: SerializerModule): SerializerPlugin => {
  const candidate = module.default ?? module
  const test = testFunctionOf(candidate)
  const serialize = serializeFunctionOf(candidate)
  const print = printFunctionOf(candidate)
  return Match.value(test).pipe(
    Match.when(Match.undefined, () => {
      throw new Error(SERIALIZER_MODULE_ERROR)
    }),
    Match.orElse((presentTest) => serializePluginOf(presentTest, serialize, print)),
  )
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

const currentRegistryFile = (): string | undefined =>
  Option.getOrUndefined(
    Option.filter(Option.fromUndefinedOr(activeRegistry?.files.current), (file) => file.length > 0),
  )

const attributedFileOf = (): string | undefined =>
  Match.value(drainWindowFile).pipe(
    Match.when(Match.undefined, () => currentRegistryFile()),
    Match.orElse((file) => file),
  )

const isCurrentTestFile = (file: string | undefined): boolean => currentSnapshotTest()?.file === file

const isSerializePlugin = (plugin: SerializerPlugin): plugin is SerializeSerializer =>
  'serialize' in plugin && typeof plugin.serialize === 'function'

const gatedSerializerOf = (plugin: SerializerPlugin, record: RecordedSerializer): SerializerPlugin => {
  const test = (value: object): boolean => isCurrentTestFile(record.file) ? plugin.test(value) : false
  return isSerializePlugin(plugin) ? { test, serialize: plugin.serialize } : { test, print: plugin.print }
}

type HijackableExpect = ExpectWithSerializers & {
  addSnapshotSerializer: (serializer: SerializerPlugin) => void
}

const isHijackableExpect = (expectApi: ExpectWithSerializers): expectApi is HijackableExpect =>
  !hijackedExpects.has(expectApi) && typeof expectApi.addSnapshotSerializer === 'function'

const installExpectHijack = (expectApi: HijackableExpect): void => {
  const realmAdd = expectApi.addSnapshotSerializer
  hijackedExpects.add(expectApi)
  expectApi.addSnapshotSerializer = (plugin: SerializerPlugin): void => {
    const record: RecordedSerializer = { plugin, file: attributedFileOf() }
    recordedSerializers.push(record)
    Reflect.apply(realmAdd, expectApi, [gatedSerializerOf(plugin, record)])
  }
}

const hijackExpect = (expectApi: ExpectWithSerializers): void => {
  if (!isHijackableExpect(expectApi)) return
  installExpectHijack(expectApi)
}

const ensureSerializerScope = (host: VmPluginHost): void => {
  const realmExpect = realmExpectOf(host)
  if (realmExpect !== undefined) hijackExpect(realmExpect)
}

const flushedFileOf = (file: string | undefined, testFile: string): string => file ?? testFile

const flushPendingSerializers = (testFile: string): void => {
  for (const record of recordedSerializers) {
    record.file = flushedFileOf(record.file, testFile)
  }
}

const projectSerializerSerializersOf = (
  project: VmProjectConfigLike | undefined,
): ReadonlyArray<SerializerPlugin> =>
  Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(project), (present) =>
      Option.fromUndefinedOr(projectSerializerCache.get(present.name))),
    () => [],
  )

type SnapshotPlugins = Exclude<SnapshotFormatLike[string], undefined>

const declaredPluginsOf = (project: VmProjectConfigLike | undefined): SnapshotPlugins | undefined =>
  project?.snapshotFormat['plugins']

const scopePluginsOf = (
  declared: SnapshotPlugins | undefined,
  fromProject: ReadonlyArray<SerializerPlugin>,
): SnapshotPlugins =>
  Option.getOrElse(
    Option.filter(Option.fromUndefinedOr(declared), (present) => Array.isArray(present) && present.length > 0),
    () => fromProject,
  )

const serializerScopeFor = (
  testFile: string,
  project: VmProjectConfigLike | undefined,
): SnapshotFormatLike | undefined => {
  const fromProject = projectSerializerSerializersOf(project)
  void testFile
  return Match.value(fromProject.length === 0).pipe(
    Match.when(true, () => undefined),
    Match.when(false, () => ({
      ...project?.snapshotFormat,
      plugins: scopePluginsOf(declaredPluginsOf(project), fromProject),
    })),
    Match.exhaustive,
  )
}

const serializerEntryOf = (
  host: VmPluginHost,
  runtime: VmVitestRuntime | undefined,
  specifier: string,
  testFile: string,
  path: Path.Path,
): string =>
  Option.getOrElse(
    Option.fromUndefinedOr(runtime?.resolveIdSync(specifier, testFile)),
    () => nodeModule.createRequire(path.join(host.sandboxWorkingDirectory, 'package.json')).resolve(specifier),
  )

const projectViewOf = (project: VmProjectConfig | undefined): VmProjectConfigLike | undefined =>
  Match.value(project).pipe(
    Match.when(Match.undefined, () => undefined),
    Match.orElse((present) => ({
      name: present.name,
      snapshotFormat: present.snapshotFormat,
      snapshotSerializers: present.snapshotSerializers,
    })),
  )

const updateModeOf = (options: SnapshotSupportOptions | undefined): SnapshotUpdateMode =>
  snapshotUpdateMode(Option.getOrElse(Option.fromUndefinedOr(options?.ci), ciOf))

const snapshotFormatFor = (testFile: string, project: VmProjectConfigLike | undefined): SnapshotFormatLike =>
  Option.getOrElse(
    Option.fromUndefinedOr(serializerScopeFor(testFile, project)),
    () => Option.getOrElse(Option.fromUndefinedOr(project?.snapshotFormat), (): SnapshotFormatLike => ({})),
  )

const scopeEqual = (first: SnapshotStateOptionsLike, second: SnapshotStateOptionsLike): boolean =>
  first.snapshotEnvironment === second.snapshotEnvironment && first.snapshotFormat === second.snapshotFormat

const optionsEqual = (first: SnapshotStateOptionsLike, second: SnapshotStateOptionsLike): boolean =>
  first.updateSnapshot === second.updateSnapshot && scopeEqual(first, second)

const makeSnapshotSupport = (
  host: VmPluginHost,
  options: SnapshotSupportOptions | undefined,
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
): SnapshotSupport => {
  recordedSerializers.length = 0
  const clients = new Map<string, SnapshotClientLike>()
  const clientFor = (file: string): SnapshotClientLike => {
    const existing = clients.get(file)
    if (existing !== undefined) return existing
    const created = snapshotClientOf()
    clients.set(file, created)
    return created
  }
  const snapshotPathFor = (testFile: string): string =>
    Option.getOrElse(
      Option.fromUndefinedOr(host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)?.resolveSnapshotPathSync(testFile)),
      () => defaultSnapshotPath(path, testFile),
    )
  const environment = createSnapshotEnvironment({ fileSystem, path, snapshotPathFor })
  const openFiles = new Set<string>()
  let runKind: VmRunKind = 'mutant'
  ensureSerializerScope(host)

  const projectFor = (testFile: string): VmProjectConfigLike | undefined =>
    projectViewOf(host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)?.projectFor(testFile))

  const optionsFor = (testFile: string): SnapshotStateOptionsLike => {
    const project = projectFor(testFile)
    return {
      updateSnapshot: updateModeOf(options),
      snapshotEnvironment: environment,
      snapshotFormat: snapshotFormatFor(testFile, project),
    }
  }

  const ensureProjectSerializers = (testFile: string, project: VmProjectConfigLike): Promise<void> => {
    if (projectSerializerCache.has(project.name)) return Promise.resolve()
    const runtime = host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)
    return project.snapshotSerializers.reduce<Promise<ReadonlyArray<SerializerPlugin>>>(
      (loaded, specifier) =>
        loaded.then((plugins) =>
          import(nodeUrl.pathToFileURL(serializerEntryOf(host, runtime, specifier, testFile, path)).href).then(
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

  const ensureSerializers = (testFile: string): Promise<void> =>
    Option.getOrElse(
      Option.map(
        Option.fromUndefinedOr(projectFor(testFile)),
        (project) => ensureProjectSerializers(testFile, project),
      ),
      () => Promise.resolve(),
    )

  const fileSetups = new Map<string, Promise<void>>()
  const openStates = new Map<string, SnapshotStateOptionsLike>()

  const startSetup = (file: string): Promise<void> => {
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

  const pendingSetup = (file: string): Promise<void> => {
    const inFlight = fileSetups.get(file)
    return inFlight === undefined ? startSetup(file) : inFlight
  }

  const settledMatches = (
    settled: SnapshotStateOptionsLike,
    current: SnapshotStateOptionsLike,
    open: boolean,
  ): boolean => optionsEqual(settled, current) && open

  const settledSession = (settled: SnapshotStateOptionsLike, file: string): Promise<void> =>
    settledMatches(settled, optionsFor(file), openFiles.has(file)) ? Promise.resolve() : pendingSetup(file)

  const openFile = (file: string): Promise<void> =>
    Match.value(openStates.get(file)).pipe(
      Match.when(Match.undefined, () => pendingSetup(file)),
      Match.orElse((settled) => settledSession(settled, file)),
    )

  const beginTest = (test: SnapshotTest, kind: VmRunKind): void => {
    runKind = kind
    clientFor(test.file).clearTest(test.file, test.id)
    setWorkerTestFile(test.file)
    setSnapshotTest(test)
  }

  const endTest = (): void => {
    setSnapshotTest(undefined)
  }

  const finishOpenFile = (file: string): Promise<void> => {
    openFiles.delete(file)
    return Match.value(runKind).pipe(
      Match.when('dry', () => clientFor(file).finish(file).then(() => undefined)),
      Match.orElse(() => Promise.resolve()),
    )
  }

  const closeFile = (file: string): Promise<void> => {
    fileSetups.delete(file)
    return Match.value(openFiles.has(file)).pipe(
      Match.when(false, () => Promise.resolve()),
      Match.when(true, () => finishOpenFile(file)),
      Match.exhaustive,
    )
  }

  const closeAll = (): Promise<void> => {
    const files = [...openFiles]
    return files.reduce((closed, file) => closed.then(() => closeFile(file)), Promise.resolve())
  }

  return { openFile, beginTest, endTest, closeFile, closeAll }
}

export const createSnapshotSupport = dual<
  (options: SnapshotSupportOptions | undefined) => (host: VmPluginHost) => Promise<SnapshotSupport>,
  (host: VmPluginHost, options?: SnapshotSupportOptions) => Promise<SnapshotSupport>
>((args) => args.length >= 1, (host, options) =>
  Effect.runPromise(
    Effect.map(
      Effect.all([FileSystem.FileSystem, Path.Path]),
      ([fileSystem, path]) => makeSnapshotSupport(host, options, fileSystem, path),
    ).pipe(Effect.provide(platformLayers)),
  ))
