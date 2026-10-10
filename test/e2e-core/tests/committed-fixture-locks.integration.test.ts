import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'

import { checkFixtureLock, driftLinesOf, fixturesOf, repoLockContextOf } from './__fixtures__/fixture-locks.js'

const Feature = makeFeature({ it })

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const PORTS = Layer.mergeAll(FILE_AND_PATH, NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)))

const REPO_ROOT_URL = new URL('../../..', import.meta.url)

const RESOURCES_URL = new URL('../../e2e/testResources', import.meta.url)

const driftOfEveryFixture = Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const staging = yield* fs.makeTempDirectoryScoped({ prefix: 'fixture-locks-' })
  const context = yield* repoLockContextOf({ repoRoot: yield* path.fromFileUrl(REPO_ROOT_URL), stagingRoot: staging })
  const fixtures = yield* fixturesOf(yield* path.fromFileUrl(RESOURCES_URL))
  const reports = yield* Effect.forEach(fixtures, (fixture) => checkFixtureLock({ context, fixture }))
  return { fixtures: fixtures.length, lines: reports.flatMap(driftLinesOf) }
}))

Feature('Committed fixture locks agree with the repository')
  .withLayer(PORTS)
  .live('every e2e fixture lock matches the packed closure, the fixture manifests and pnpm-lock.yaml, offline')
  .body(({ scenario }) => {
    scenario(
      'Every fixture installs from a lock that npm ls accepts and that names no drift',
      Gherkin.Do.pipe(
        Given('the e2e fixtures under test/e2e/testResources')('resources', () => Effect.succeed(RESOURCES_URL.href)),
        When('each fixture is staged against the packed closure and checked against its lock')(
          'drift',
          () => driftOfEveryFixture,
        ),
        Then('no fixture reports E2E_PINS_DRIFT')((s, expect) =>
          expect({ checked: s.drift.fixtures > 0, drift: s.drift.lines.join('\n') }).toStrictEqual({
            checked: true,
            drift: '',
          })
        ),
      ),
    )
  })
