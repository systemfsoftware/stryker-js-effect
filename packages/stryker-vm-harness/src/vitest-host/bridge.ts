import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import type { VmProjectConfig, VmVitestConfig } from '../vitest-config.schema.js'
import { defaultProjectConfig, defaultVitestConfig } from './defaults.js'
import { docblockOf } from './docblock-cache.js'
import type { EnvironmentDocblock } from './docblock.js'
import type { VmHostAnnouncement, VmHostInitMessage, VmHostReply, VmHostRequest } from './host-thread.js'
import { basename, dirname, existsSync, globSync, join, realpath, resolve } from './node-builtins.js'
import type { VmTransformResult, VmVitestRuntime } from './runtime.js'

const moduleBuiltin = globalThis.process.getBuiltinModule('node:module')
const urlBuiltin = globalThis.process.getBuiltinModule('node:url')
const workerThreads = globalThis.process.getBuiltinModule('node:worker_threads')

const { createRequire } = moduleBuiltin
const { pathToFileURL } = urlBuiltin
const { MessageChannel, Worker, receiveMessageOnPort } = workerThreads

type MessagePort = InstanceType<typeof workerThreads.MessagePort>
type VmWorker = InstanceType<typeof workerThreads.Worker>

type AnyDecoded<A = unknown> = A

const digestHashOf = (input: string): string => {
  const raw = new TextEncoder().encode(input)
  let hash = 0x811c9dc5
  for (const byte of raw) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  hash += hash << 13
  hash ^= hash >>> 7
  hash += hash << 3
  hash ^= hash >>> 17
  hash += hash << 5
  return (hash >>> 0).toString(16)
}

export interface VmVitestBridgeOptions {
  readonly sandboxWorkingDirectory: string
  readonly configFile: string | undefined
}

export interface VmVitestHostHandle {
  readonly runtime: VmVitestRuntime
  readonly hasTransformPlugins: boolean
  readonly listTestFiles: () => Promise<ReadonlyArray<string>>
  readonly close: () => Promise<void>
}

type HostState = 'unspawned' | 'ready' | 'failed' | 'closed'

const CACHE_LIMIT = 4096
const DEAD_THREAD_POLL_MS = 50
const NO_ANNOUNCEMENT_MESSAGE = 'Vitest transform host produced no announcement'
const NO_CHANNEL_MESSAGE = 'Vitest transform host has no message channel'
const NO_FLAGS_MESSAGE = 'Vitest transform host has no synchronization buffer'
const NO_REPLY_MESSAGE = 'Vitest transform host produced no reply'
const OUT_OF_ORDER_MESSAGE = 'Vitest transform host replied out of order'
const EXITED_MESSAGE = 'Vitest transform host thread exited unexpectedly'
const START_FAILED_MESSAGE = 'Vitest transform host failed to start'
const CLOSED_MESSAGE = 'Vitest transform host was closed'

const cleanIdOf = (id: string): string => id.split('?')[0] ?? id

const defaultSnapshotPath = (testPath: string): string =>
  join(dirname(testPath), '__snapshots__', `${basename(testPath)}.snap`)

const GLOB_RECURSIVE_PLACEHOLDER = '__GLOB_RECURSIVE__'

const patternToRegExp = (pattern: string): RegExp => {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, GLOB_RECURSIVE_PLACEHOLDER)
    .replaceAll(GLOB_RECURSIVE_PLACEHOLDER, '(?:.*/)?')
    .replace(/[*]/g, '[^/]*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${body}$`)
}

const globCandidate = (pattern: string, root: string): string =>
  pattern.startsWith('/') ? pattern : `${root}/${pattern}`

const matchesGlob = (file: string, pattern: string, root: string): boolean => {
  try {
    return patternToRegExp(globCandidate(pattern, root)).test(file)
  } catch {
    return false
  }
}

const matchesFile = (project: VmProjectConfig, file: string): boolean =>
  project.include.some((pattern) => matchesGlob(file, pattern, project.root))

const DEFAULT_IGNORED = /^(?:node_modules|\.git)(?:\/|$)/

const ignoredByDefault = (entry: string): boolean => DEFAULT_IGNORED.test(entry)

const inThreadTestFiles = (sandboxWorkingDirectory: string): ReadonlyArray<string> => {
  const defaultConfig = defaultProjectConfig(sandboxWorkingDirectory)
  const toPath = (entry: string | { readonly name: string }): string => typeof entry === 'string' ? entry : entry.name
  const files = defaultConfig.include.flatMap((pattern) =>
    globSync(pattern, { cwd: sandboxWorkingDirectory, exclude: ignoredByDefault }).map(toPath)
  )
  return files.map((file) => resolve(sandboxWorkingDirectory, file))
}

const workerEntry = (): { readonly url: URL; readonly execArgv: ReadonlyArray<string> } => {
  const requireFromCwd = createRequire(join(globalThis.process.cwd(), 'noop.js'))
  const packageJsonPath = requireFromCwd.resolve('@systemfsoftware/stryker-vm-harness/package.json')
  const packageRoot = dirname(packageJsonPath)
  const distEntry = join(packageRoot, 'dist', 'vitest-host-worker.mjs')
  if (existsSync(distEntry)) {
    return { url: pathToFileURL(distEntry), execArgv: [] }
  }
  const hostDirectory = join(packageRoot, 'src', 'shell', 'vitest-host')
  return {
    url: pathToFileURL(join(hostDirectory, 'host-thread.ts')),
    execArgv: ['--import', pathToFileURL(join(hostDirectory, 'ts-source-loader.ts')).href],
  }
}

const storeValue = <K, V>(store: Map<K, V>, key: K, compute: () => V): V => {
  if (store.size >= CACHE_LIMIT) store.clear()
  const value = compute()
  store.set(key, value)
  return value
}

const cached = <K, V>(store: Map<K, V>, key: K, compute: () => V): V => {
  const hit = store.get(key)
  if (hit !== undefined) return hit
  return storeValue(store, key, compute)
}

const optionalConfigField = (configFile: string | undefined): { readonly configFile?: string } =>
  configFile === undefined ? {} : { configFile }

const initMessageOf = (
  sandboxWorkingDirectory: string,
  configFile: string | undefined,
  port: MessagePort,
  sharedBuffer: SharedArrayBuffer,
): VmHostInitMessage => ({
  sandboxWorkingDirectory,
  ...optionalConfigField(configFile),
  port,
  sharedBuffer,
})

const requireFlags = (flags: Int32Array | undefined): Int32Array => {
  if (flags === undefined) throw new Error(NO_FLAGS_MESSAGE)
  return flags
}

const requirePort = (port: MessagePort | undefined): MessagePort => {
  if (port === undefined) throw new Error(NO_CHANNEL_MESSAGE)
  return port
}

const messageOr = (error: AnyDecoded, fallback: string): string => error instanceof Error ? error.message : fallback

const pollSignal = (flags: Int32Array): boolean => {
  const outcome = Atomics.wait(flags, 0, 0, DEAD_THREAD_POLL_MS)
  return outcome === 'ok' || outcome === 'not-equal'
}

const ensureAlive = (hasExited: () => boolean): void => {
  if (hasExited()) throw new Error(EXITED_MESSAGE)
}

const awaitSignal = (flags: Int32Array, hasExited: () => boolean): void => {
  while (!pollSignal(flags)) ensureAlive(hasExited)
}

const kindOf = (value: object): string => String(Reflect.get(value, 'kind'))

const isKnownAnnouncementKind = (value: object): boolean => kindOf(value) === 'ready' || kindOf(value) === 'init-failed'

const isHostAnnouncement = (value: unknown): value is VmHostAnnouncement =>
  Predicate.isObject(value) && isKnownAnnouncementKind(value)

const HOST_REPLY_KINDS: ReadonlySet<string> = new Set([
  'transform',
  'resolveId',
  'snapshotPath',
  'files',
  'projects',
  'error',
])

const isKnownReplyKind = (value: object): boolean => HOST_REPLY_KINDS.has(kindOf(value))

const isHostReply = (value: unknown): value is VmHostReply => Predicate.isObject(value) && isKnownReplyKind(value)

const announcementOf = (hostPort: MessagePort): VmHostAnnouncement | undefined =>
  Option.getOrUndefined(Option.liftPredicate(isHostAnnouncement)(receiveMessageOnPort(hostPort)?.message))

const replyAt = (hostPort: MessagePort): VmHostReply | undefined =>
  Option.getOrUndefined(Option.liftPredicate(isHostReply)(receiveMessageOnPort(hostPort)?.message))

type TransformReply = Extract<VmHostReply, { readonly kind: 'transform' }> & { readonly code: string }

interface HostProjectFiles {
  readonly name: string
  readonly files: ReadonlyArray<string>
}

const isTransformReply = (reply: VmHostReply): reply is TransformReply =>
  reply.kind === 'transform' && typeof reply.code === 'string'

const transformCodeOf = (reply: VmHostReply): VmTransformResult | undefined =>
  isTransformReply(reply) ? { code: reply.code } : undefined

const resolvedIdOf = (reply: VmHostReply): string | undefined => reply.kind === 'resolveId' ? reply.resolved : undefined

const snapshotPathOf = (reply: VmHostReply): string | undefined =>
  reply.kind === 'snapshotPath' ? reply.path : undefined

const filesOf = (reply: VmHostReply): ReadonlyArray<string> => reply.kind === 'files' ? [...reply.files] : []

const drainPort = (hostPort: MessagePort): void => {
  while (receiveMessageOnPort(hostPort) !== undefined) {}
}

const hasDocblockOverride = (docblock: EnvironmentDocblock): boolean =>
  docblock.environment !== undefined || docblock.environmentOptions !== undefined

const overriddenProject = (base: VmProjectConfig, docblock: EnvironmentDocblock): VmProjectConfig => ({
  ...base,
  environment: docblock.environment ?? base.environment,
  environmentOptions: { ...base.environmentOptions, ...docblock.environmentOptions },
})

const withDocblockOverride = (base: VmProjectConfig, testFile: string): VmProjectConfig => {
  const docblock = docblockOf(testFile)
  return hasDocblockOverride(docblock) ? overriddenProject(base, docblock) : base
}

export const createVmVitestRuntime = (options: VmVitestBridgeOptions): VmVitestHostHandle => {
  const { sandboxWorkingDirectory, configFile } = options
  const sandboxRoot = realpath(resolve(sandboxWorkingDirectory))

  let state: HostState = 'unspawned'
  let worker: VmWorker | undefined
  let port: MessagePort | undefined
  let flags: Int32Array | undefined
  let exited = false
  let failureMessage = ''
  let hostConfig: VmVitestConfig | undefined
  let hostHasTransformPlugins = false
  let nextSeq = 0
  let projectFilesResolved = false
  const projectFilesByPath = new Map<string, VmProjectConfig>()
  const transformCache = new Map<string, VmTransformResult>()
  const projectForCache = new Map<string, VmProjectConfig>()

  const configOf = (): VmVitestConfig => hostConfig ?? defaultVitestConfig(sandboxRoot)

  const failSpawn = (spawned: VmWorker, message: string): never => {
    state = 'failed'
    failureMessage = message
    void spawned.terminate()
    throw new Error(message)
  }

  const requireAnnouncement = (
    spawned: VmWorker,
    announcement: VmHostAnnouncement | undefined,
  ): VmHostAnnouncement => announcement === undefined ? failSpawn(spawned, NO_ANNOUNCEMENT_MESSAGE) : announcement

  const requireReadyAnnouncement = (
    spawned: VmWorker,
    announcement: VmHostAnnouncement,
  ): Extract<VmHostAnnouncement, { readonly kind: 'ready' }> =>
    announcement.kind === 'init-failed' ? failSpawn(spawned, announcement.message) : announcement

  const applyAnnouncement = (spawned: VmWorker, hostPort: MessagePort): void => {
    const ready = requireReadyAnnouncement(spawned, requireAnnouncement(spawned, announcementOf(hostPort)))
    hostConfig = ready.config
    hostHasTransformPlugins = ready.hasTransformPlugins
    state = 'ready'
  }

  const startSpawned = (spawned: VmWorker): void => {
    try {
      awaitSignal(requireFlags(flags), () => exited)
    } catch (error) {
      failSpawn(spawned, messageOr(error, START_FAILED_MESSAGE))
    }
    applyAnnouncement(spawned, requirePort(port))
  }

  const spawnHost = (): void => {
    const entry = workerEntry()
    const channel = new MessageChannel()
    const sharedBuffer = new SharedArrayBuffer(8)
    flags = new Int32Array(sharedBuffer)
    port = channel.port1
    const spawned = new Worker(entry.url, { stdout: true, stderr: true, execArgv: [...entry.execArgv] })
    spawned.unref()
    spawned.on('exit', () => {
      exited = true
    })
    worker = spawned
    spawned.postMessage(initMessageOf(sandboxRoot, configFile, channel.port2, sharedBuffer), [channel.port2])
    startSpawned(spawned)
  }

  const hostUnavailableMessage = (): string => state === 'failed' ? failureMessage : CLOSED_MESSAGE

  const ensureSpawnedState = (): void => {
    if (state === 'ready') return
    throw new Error(hostUnavailableMessage())
  }

  const ensureHost = (): void => {
    if (state === 'unspawned') {
      spawnHost()
      return
    }
    ensureSpawnedState()
  }

  const requireReply = (hostPort: MessagePort): VmHostReply => {
    const reply = replyAt(hostPort)
    if (reply === undefined) throw new Error(NO_REPLY_MESSAGE)
    return reply
  }

  const assertReplyKind = (reply: VmHostReply): void => {
    if (reply.kind === 'error') throw new Error(reply.message)
  }

  const assertReplyOrder = (reply: VmHostReply, seq: number): void => {
    if (reply.seq !== seq) throw new Error(OUT_OF_ORDER_MESSAGE)
  }

  const checkReply = (hostPort: MessagePort, seq: number): VmHostReply => {
    const reply = requireReply(hostPort)
    assertReplyKind(reply)
    assertReplyOrder(reply, seq)
    return reply
  }

  const request = (payload: VmHostRequest): VmHostReply => {
    ensureHost()
    const activePort = requirePort(port)
    const sharedFlags = requireFlags(flags)
    drainPort(activePort)
    Atomics.store(sharedFlags, 0, 0)
    nextSeq += 1
    const seq = nextSeq
    activePort.postMessage({ ...payload, seq })
    awaitSignal(sharedFlags, () => exited)
    return checkReply(activePort, seq)
  }

  const projectConfigByName = (name: string): VmProjectConfig | undefined =>
    configOf().projects.find((candidate) => candidate.name === name)

  const recordProjectFilesOf = (files: ReadonlyArray<string>, config: VmProjectConfig): void => {
    for (const file of files) projectFilesByPath.set(file, config)
  }

  const recordProject = (project: HostProjectFiles): void => {
    const config = projectConfigByName(project.name)
    if (config !== undefined) recordProjectFilesOf(project.files, config)
  }

  const forEachProject = (projects: ReadonlyArray<HostProjectFiles>): void => {
    for (const project of projects) recordProject(project)
  }

  const recordProjects = (reply: VmHostReply): void => {
    if (reply.kind === 'projects') forEachProject(reply.projects)
  }

  const projectFilesNeeded = (): boolean => hostConfig !== undefined && !projectFilesResolved

  const resolveProjectFiles = (): void => {
    if (!projectFilesNeeded()) return
    projectFilesResolved = true
    recordProjects(request({ kind: 'projectFiles', seq: 0 }))
  }

  const projectFilesEntryOf = (testFile: string): VmProjectConfig | undefined => projectFilesByPath.get(testFile)

  const matchingProjectOf = (
    projects: ReadonlyArray<VmProjectConfig>,
    testFile: string,
  ): VmProjectConfig | undefined => projects.find((project) => matchesFile(project, testFile))

  const firstProjectOr = (projects: ReadonlyArray<VmProjectConfig>): VmProjectConfig =>
    projects[0] ?? defaultProjectConfig(sandboxRoot)

  const projectFallbackOf = (
    projects: ReadonlyArray<VmProjectConfig>,
    testFile: string,
  ): VmProjectConfig => matchingProjectOf(projects, testFile) ?? firstProjectOr(projects)

  const baseProjectFor = (testFile: string): VmProjectConfig => {
    resolveProjectFiles()
    const projects = configOf().projects
    return projectFilesEntryOf(testFile) ?? projectFallbackOf(projects, testFile)
  }

  const transformableId = (cleanId: string): boolean => cleanId.startsWith(sandboxRoot) && configFile !== undefined

  const transformKeyOf = (cleanId: string, code: string): string => `${cleanId}#${digestHashOf(code)}`

  const transformResultOf = (code: string, id: string): VmTransformResult | undefined => {
    try {
      return transformCodeOf(request({ kind: 'transform', code, moduleId: id, seq: 0 }))
    } catch {
      return undefined
    }
  }

  const loadFileOf = (cleanId: string): VmTransformResult | undefined => {
    try {
      return transformCodeOf(request({ kind: 'transformRequest', moduleId: cleanId, seq: 0 }))
    } catch (error) {
      throw new Error(`Vitest transform host failed for '${cleanId}'`, { cause: error })
    }
  }

  const snapshotPathFromHost = (testPath: string): string | undefined => {
    try {
      return snapshotPathOf(request({ kind: 'snapshotPath', testPath, seq: 0 }))
    } catch {
      return undefined
    }
  }

  const snapshotPathOrDefault = (testPath: string): string =>
    snapshotPathFromHost(testPath) ?? defaultSnapshotPath(testPath)

  const runtime: VmVitestRuntime = {
    get config(): VmVitestConfig {
      return configOf()
    },
    projectFor: (testFile: string): VmProjectConfig =>
      cached(projectForCache, testFile, () => withDocblockOverride(baseProjectFor(testFile), testFile)),
    transformSync: (code: string, id: string): VmTransformResult | undefined => {
      const cleanId = cleanIdOf(id)
      if (!transformableId(cleanId)) return undefined
      return cached(transformCache, transformKeyOf(cleanId, code), () => transformResultOf(code, id))
    },
    loadFileSync: (id: string): VmTransformResult | undefined => {
      const cleanId = cleanIdOf(id)
      if (!cleanId.startsWith(sandboxRoot)) return undefined
      return loadFileOf(cleanId)
    },
    resolveIdSync: (specifier: string, importer: string): string | undefined => {
      try {
        return resolvedIdOf(request({ kind: 'resolveId', specifier, importer, seq: 0 }))
      } catch {
        return undefined
      }
    },
    resolveSnapshotPathSync: (testPath: string): string =>
      state !== 'ready' ? defaultSnapshotPath(testPath) : snapshotPathOrDefault(testPath),
    close: (): Promise<void> => {
      const activeWorker = worker
      if (activeWorker === undefined) return Promise.resolve()
      state = 'closed'
      worker = undefined
      return activeWorker.terminate().then(() => undefined)
    },
  }

  spawnHost()

  return {
    runtime,
    hasTransformPlugins: hostHasTransformPlugins,
    listTestFiles: (): Promise<ReadonlyArray<string>> => {
      if (hostConfig === undefined) return Promise.resolve(inThreadTestFiles(sandboxRoot))
      return Promise.resolve(filesOf(request({ kind: 'listTestFiles', seq: 0 })))
    },
    close: runtime.close,
  }
}
