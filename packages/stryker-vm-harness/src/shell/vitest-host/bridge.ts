import { createRequire } from 'node:module'

import { pathToFileURL } from 'node:url'
import { MessageChannel, type MessagePort, receiveMessageOnPort, Worker } from 'node:worker_threads'
import { basename, dirname, existsSync, globSync, join, resolve } from './node-builtins.js'

import type { VmProjectConfig, VmVitestConfig } from '../../core/vitest-config.schema.js'
import { defaultProjectConfig, defaultVitestConfig } from './defaults.js'
import { docblockOf } from './docblock-cache.js'
import type { VmHostAnnouncement, VmHostInitMessage, VmHostReply, VmHostRequest } from './host-thread.js'
import type { VmTransformResult, VmVitestRuntime } from './runtime.js'

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

const matchesGlob = (file: string, pattern: string, root: string): boolean => {
  const candidate = pattern.startsWith('/') ? pattern : `${root}/${pattern}`
  try {
    return patternToRegExp(candidate).test(file)
  } catch {
    return false
  }
}

const matchesFile = (project: VmProjectConfig, file: string): boolean =>
  project.include.some((pattern) => matchesGlob(file, pattern, project.root))

const ignoredByDefault = (entry: string): boolean =>
  entry === 'node_modules' || entry.startsWith('node_modules/') || entry === '.git' || entry.startsWith('.git/')

const inThreadTestFiles = (sandboxWorkingDirectory: string): ReadonlyArray<string> => {
  const defaultConfig = defaultProjectConfig(sandboxWorkingDirectory)
  const toPath = (entry: string | { readonly name: string }): string => typeof entry === 'string' ? entry : entry.name
  const files = defaultConfig.include.flatMap((pattern) =>
    globSync(pattern, { cwd: sandboxWorkingDirectory, exclude: ignoredByDefault }).map(toPath)
  )
  return files.map((file) => resolve(sandboxWorkingDirectory, file))
}

const workerEntry = (): { readonly url: URL; readonly execArgv: ReadonlyArray<string> } => {
  const requireFromCwd = createRequire(join(process.cwd(), 'noop.js'))
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

const cached = <K, V>(store: Map<K, V>, key: K, compute: () => V): V => {
  const hit = store.get(key)
  if (hit !== undefined) return hit
  if (store.size >= CACHE_LIMIT) store.clear()
  const value = compute()
  store.set(key, value)
  return value
}

export const createVmVitestRuntime = (options: VmVitestBridgeOptions): VmVitestHostHandle => {
  const { sandboxWorkingDirectory, configFile } = options
  const sandboxRoot = resolve(sandboxWorkingDirectory)

  let state: HostState = 'unspawned'
  let worker: Worker | undefined
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

  const waitForSignal = (): void => {
    const sharedFlags = flags
    if (sharedFlags === undefined) throw new Error('Vitest transform host has no synchronization buffer')
    for (;;) {
      const outcome = Atomics.wait(sharedFlags, 0, 0, DEAD_THREAD_POLL_MS)
      if (outcome === 'ok' || outcome === 'not-equal') return
      if (exited) throw new Error('Vitest transform host thread exited unexpectedly')
    }
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
    const init: VmHostInitMessage = {
      sandboxWorkingDirectory: sandboxRoot,
      ...(configFile === undefined ? {} : { configFile }),
      port: channel.port2,
      sharedBuffer,
    }
    spawned.postMessage(init, [channel.port2])
    try {
      waitForSignal()
    } catch (error) {
      state = 'failed'
      failureMessage = error instanceof Error ? error.message : 'Vitest transform host failed to start'
      void spawned.terminate()
      throw error
    }
    const announcement = receiveMessageOnPort(port)?.message as VmHostAnnouncement | undefined
    if (announcement === undefined || announcement.kind === 'init-failed') {
      state = 'failed'
      failureMessage = announcement?.message ?? 'Vitest transform host produced no announcement'
      void spawned.terminate()
      throw new Error(failureMessage)
    }
    hostConfig = announcement.config
    hostHasTransformPlugins = announcement.hasTransformPlugins
    state = 'ready'
  }

  const ensureHost = (): void => {
    if (state === 'ready') return
    if (state === 'failed') throw new Error(failureMessage)
    if (state === 'closed') throw new Error('Vitest transform host was closed')
    spawnHost()
  }

  const request = (payload: VmHostRequest): VmHostReply => {
    ensureHost()
    const activePort = port
    const sharedFlags = flags
    if (activePort === undefined || sharedFlags === undefined) {
      throw new Error('Vitest transform host has no message channel')
    }
    while (receiveMessageOnPort(activePort) !== undefined) {}
    Atomics.store(sharedFlags, 0, 0)
    nextSeq += 1
    const seq = nextSeq
    activePort.postMessage({ ...payload, seq })
    waitForSignal()
    const reply = receiveMessageOnPort(activePort)?.message as VmHostReply | undefined
    if (reply === undefined) throw new Error('Vitest transform host produced no reply')
    if (reply.kind === 'error') throw new Error(reply.message)
    if (reply.seq !== seq) throw new Error('Vitest transform host replied out of order')
    return reply
  }

  const resolveProjectFiles = (): void => {
    if (hostConfig === undefined || projectFilesResolved) return
    projectFilesResolved = true
    const reply = request({ kind: 'projectFiles', seq: 0 })
    if (reply.kind !== 'projects') return
    for (const project of reply.projects) {
      const config = configOf().projects.find((candidate) => candidate.name === project.name)
      if (config === undefined) continue
      for (const file of project.files) {
        projectFilesByPath.set(file, config)
      }
    }
  }

  const runtime: VmVitestRuntime = {
    get config(): VmVitestConfig {
      return configOf()
    },
    projectFor: (testFile: string): VmProjectConfig =>
      cached(projectForCache, testFile, () => {
        resolveProjectFiles()
        const projects = configOf().projects
        const base = projectFilesByPath.get(testFile) ?? projects.find((project) => matchesFile(project, testFile)) ??
          projects[0] ?? defaultProjectConfig(sandboxRoot)
        const docblock = docblockOf(testFile)
        if (docblock.environment === undefined && docblock.environmentOptions === undefined) return base
        return {
          ...base,
          environment: docblock.environment ?? base.environment,
          environmentOptions: { ...base.environmentOptions, ...docblock.environmentOptions },
        }
      }),
    transformSync: (code: string, id: string): VmTransformResult | undefined => {
      const cleanId = cleanIdOf(id)
      if (!cleanId.startsWith(sandboxRoot) || configFile === undefined) return undefined
      const hash = digestHashOf(code)
      return cached(transformCache, `${cleanId}#${hash}`, () => {
        try {
          const reply = request({ kind: 'transform', code, moduleId: id, seq: 0 })
          return reply.kind === 'transform' && typeof reply.code === 'string' ? { code: reply.code } : undefined
        } catch {
          return undefined
        }
      })
    },
    loadFileSync: (id: string): VmTransformResult | undefined => {
      const cleanId = cleanIdOf(id)
      if (!cleanId.startsWith(sandboxRoot)) return undefined
      try {
        const reply = request({ kind: 'transformRequest', moduleId: cleanId, seq: 0 })
        if (reply.kind === 'transform' && typeof reply.code === 'string') return { code: reply.code }
      } catch (error) {
        throw new Error(`Vitest transform host failed for '${cleanId}'`, { cause: error })
      }
      return undefined
    },
    resolveIdSync: (specifier: string, importer: string): string | undefined => {
      try {
        const reply = request({ kind: 'resolveId', specifier, importer, seq: 0 })
        return reply.kind === 'resolveId' ? reply.resolved : undefined
      } catch {
        return undefined
      }
    },
    resolveSnapshotPathSync: (testPath: string): string => {
      if (state === 'ready') {
        try {
          const reply = request({ kind: 'snapshotPath', testPath, seq: 0 })
          if (reply.kind === 'snapshotPath') return reply.path
        } catch {
          return defaultSnapshotPath(testPath)
        }
      }
      return defaultSnapshotPath(testPath)
    },
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
      const reply = request({ kind: 'listTestFiles', seq: 0 })
      return Promise.resolve(reply.kind === 'files' ? [...reply.files] : [])
    },
    close: runtime.close,
  }
}
