import { Session } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import type { EnvironmentSandbox, SandboxFileSpec } from './environment-sandbox.js'

const VM_VITEST_BAG_KEY = 'vitest'

const stripViteFilePrefix = (pathname: string): string =>
  pathname.startsWith('/@fs/') ? pathname.slice('/@fs'.length) : pathname

const NODE_MODULES_LINK_SOURCE = stripViteFilePrefix(
  decodeURIComponent(new URL('../../../stryker-js/node_modules', import.meta.url).pathname),
)

export interface LinkedPackageSpec {
  readonly name: string
  readonly files: readonly SandboxFileSpec[]
}

export interface OutOfRootSandboxSpec {
  readonly projectFiles: readonly SandboxFileSpec[]
  readonly sharedFiles?: readonly SandboxFileSpec[]
  readonly setupFiles?: readonly string[]
  readonly linkedPackages?: readonly LinkedPackageSpec[]
  readonly globals?: boolean
}

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

export const outOfRootSandboxOf = (
  spec: OutOfRootSandboxSpec,
): Effect.Effect<EnvironmentSandbox, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const workspace = yield* fs.makeTempDirectory()
    const root = path.join(workspace, 'project')
    const shared = path.join(workspace, 'shared')
    yield* fs.makeDirectory(root)
    yield* fs.makeDirectory(shared)
    yield* fs.symlink(NODE_MODULES_LINK_SOURCE, path.join(workspace, 'node_modules'))
    yield* fs.writeFileString(path.join(root, 'package.json'), '{"type":"module"}\n')
    yield* fs.makeDirectory(path.join(root, 'node_modules'))

    for (const file of spec.sharedFiles ?? []) {
      yield* fs.writeFileString(path.join(shared, file.name), file.source)
    }

    for (const linked of spec.linkedPackages ?? []) {
      const packageRoot = path.join(workspace, 'store', 'node_modules', linked.name)
      yield* fs.makeDirectory(packageRoot, { recursive: true })
      yield* fs.writeFileString(
        path.join(packageRoot, 'package.json'),
        '{"name":"' + linked.name + '","type":"module","main":"index.js"}\n',
      )
      for (const file of linked.files) {
        yield* fs.writeFileString(path.join(packageRoot, file.name), file.source)
      }
      yield* fs.symlink(packageRoot, path.join(root, 'node_modules', linked.name))
    }

    const testFiles: Array<string> = []
    for (const file of spec.projectFiles) {
      const fullPath = path.join(root, file.name)
      yield* fs.writeFileString(fullPath, file.source)
      testFiles.push(fullPath)
    }

    const projectConfig: StubProjectConfig = {
      name: '',
      root,
      environment: 'node',
      environmentOptions: {},
      globals: spec.globals ?? false,
      setupFiles: (spec.setupFiles ?? []).map((name) => path.join(shared, name)),
      define: {},
      env: {},
    }

    const stubConfigPlugin: Session.VmSessionPlugin = {
      name: 'vitest-config-stub',
      init: (host) => {
        host.state.write(VM_VITEST_BAG_KEY, { projectFor: () => projectConfig })
      },
    }

    const session: Promise<Session.VmSession> = Session.createVmSession(
      { sandboxWorkingDirectory: root, testFiles },
      [
        stubConfigPlugin,
        Session.definePlugin,
        Session.environmentPlugin,
        Session.globalsPlugin,
        Session.setupFilesPlugin,
      ],
    )

    return {
      directory: root,
      files: testFiles,
      runSuite: Effect.promise(() =>
        session.then((started) => started.run({ kind: 'dry', timeoutMs: 30000, reloadEnvironment: true }))
      ),
      dispose: Effect.promise(() => session.then((started) => started.dispose())),
    }
  }).pipe(Effect.orDie)
