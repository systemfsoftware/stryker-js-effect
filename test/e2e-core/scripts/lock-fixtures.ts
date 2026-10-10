import { NodeFileSystem, NodePath, NodeRuntime } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'

import { fixturesOf, lockFixture, repoLockContextOf } from '../tests/__fixtures__/fixture-locks.js'

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const PORTS = Layer.mergeAll(FILE_AND_PATH, NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)))

const lockEveryFixture = Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const staging = yield* fs.makeTempDirectoryScoped({ prefix: 'fixture-locks-' })
  const repoRoot = yield* path.fromFileUrl(new URL('../../..', import.meta.url))
  const context = yield* repoLockContextOf({ repoRoot, stagingRoot: staging })
  const fixtures = yield* fixturesOf(path.join(repoRoot, 'test', 'e2e', 'testResources'))
  yield* Effect.forEach(fixtures, (fixture) =>
    lockFixture({ context, fixture }).pipe(
      Effect.tap(() => Effect.log(`locked ${fixture.fixtureId}`)),
    ))
}))

NodeRuntime.runMain(lockEveryFixture.pipe(Effect.provide(PORTS)))
