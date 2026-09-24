import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Session } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'

const VM_VITEST_BAG_KEY = 'vitest'

const stripViteFilePrefix = (pathname: string): string =>
  pathname.startsWith('/@fs/') ? pathname.slice('/@fs'.length) : pathname

const NODE_MODULES_LINK_SOURCE = stripViteFilePrefix(
  decodeURIComponent(new URL('../../../stryker-js/node_modules', import.meta.url).pathname),
)

export interface SandboxFileSpec {
  readonly name: string
  readonly source: string
}

export interface SandboxProject {
  readonly environment: string
  readonly environmentOptions: Record<string, object | string | number | boolean>
  readonly globals: boolean
  readonly setupFiles: readonly string[]
  readonly define: Record<string, string>
  readonly env: Record<string, string>
}

export const sandboxProject = (overrides: Partial<SandboxProject>): SandboxProject => ({
  environment: 'node',
  environmentOptions: {},
  globals: false,
  setupFiles: [],
  define: {},
  env: {},
  ...overrides,
})

interface StubProjectConfig {
  readonly name: string
  readonly root: string
  readonly environment: string
  readonly environmentOptions: Record<string, object | string | number | boolean>
  readonly globals: boolean
  readonly setupFiles: readonly string[]
  readonly define: Record<string, string>
  readonly env: Record<string, string>
}

export interface EnvironmentSandbox {
  readonly directory: string
  readonly files: ReadonlyArray<string>
  readonly runSuite: Effect.Effect<Session.VmRunResponse>
  readonly dispose: Effect.Effect<void>
}

export interface SandboxOutcome {
  readonly status: string
  readonly message: string | undefined
  readonly results: ReadonlyArray<{
    readonly name: string
    readonly status: string
    readonly failureMessage: string | undefined
  }>
}

export const outcomeOf = (response: Session.VmRunResponse): SandboxOutcome => {
  if (response.status !== 'complete') {
    return {
      status: response.status,
      message: response.status === 'init-failed' ? response.message : undefined,
      results: [],
    }
  }
  return {
    status: response.status,
    message: undefined,
    results: response.tests.map((test) => ({
      name: test.name,
      status: test.status,
      failureMessage: test.failureMessage,
    })),
  }
}

export const globalString = (key: string): string | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
  return descriptor === undefined || descriptor.value === undefined ? undefined : String(descriptor.value)
}

export const hasGlobal = (key: string): boolean => Object.getOwnPropertyDescriptor(globalThis, key) !== undefined

export const environmentSandboxOf = dual<
  (
    projectForFile: (file: string) => SandboxProject,
  ) => (
    files: readonly SandboxFileSpec[],
  ) => Effect.Effect<EnvironmentSandbox, never, FileSystem.FileSystem | Path.Path>,
  (
    files: readonly SandboxFileSpec[],
    projectForFile: (file: string) => SandboxProject,
  ) => Effect.Effect<EnvironmentSandbox, never, FileSystem.FileSystem | Path.Path>
>(2, (files, projectForFile) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectory()
    return yield* sandboxInDirectory(directory, files, projectForFile)
  }).pipe(Effect.orDie))

export const symlinkedEnvironmentSandboxOf = dual<
  (
    projectForFile: (file: string) => SandboxProject,
  ) => (
    files: readonly SandboxFileSpec[],
  ) => Effect.Effect<EnvironmentSandbox, never, FileSystem.FileSystem | Path.Path>,
  (
    files: readonly SandboxFileSpec[],
    projectForFile: (file: string) => SandboxProject,
  ) => Effect.Effect<EnvironmentSandbox, never, FileSystem.FileSystem | Path.Path>
>(2, (files, projectForFile) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const real = yield* fs.makeTempDirectory()
    yield* fs.symlink(real, `${real}-linked`)
    return yield* sandboxInDirectory(`${real}-linked`, files, projectForFile)
  }).pipe(Effect.orDie))

const sandboxInDirectory = (
  directory: string,
  files: readonly SandboxFileSpec[],
  projectForFile: (file: string) => SandboxProject,
): Effect.Effect<EnvironmentSandbox, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.writeFileString(path.join(directory, 'package.json'), '{"type":"module"}\n')
    yield* fs.symlink(NODE_MODULES_LINK_SOURCE, path.join(directory, 'node_modules'))
    const testFiles: Array<string> = []
    for (const file of files) {
      const fullPath = path.join(directory, file.name)
      yield* fs.writeFileString(fullPath, file.source)
      testFiles.push(fullPath)
    }

    const projectConfigFor = (file: string): StubProjectConfig => {
      const project = projectForFile(file)
      return {
        name: '',
        root: directory,
        environment: project.environment,
        environmentOptions: project.environmentOptions,
        globals: project.globals,
        setupFiles: project.setupFiles.map((name) => path.join(directory, name)),
        define: project.define,
        env: project.env,
      }
    }

    const stubConfigPlugin: Session.VmSessionPlugin = {
      name: 'vitest-config-stub',
      init: (host) => {
        host.state.write(VM_VITEST_BAG_KEY, { projectFor: projectConfigFor })
      },
    }

    const session: Promise<Session.VmSession> = Session.createVmSession(
      { sandboxWorkingDirectory: directory, testFiles },
      [
        stubConfigPlugin,
        Session.definePlugin,
        Session.environmentPlugin,
        Session.globalsPlugin,
        Session.setupFilesPlugin,
      ],
    )

    return {
      directory,
      files: testFiles,
      runSuite: Effect.promise(() =>
        session.then((started) => started.run({ kind: 'dry', timeoutMs: 30000, reloadEnvironment: true }))
      ),
      dispose: Effect.promise(() => session.then((started) => started.dispose())),
    }
  }).pipe(Effect.orDie)

export const suiteFileLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)
