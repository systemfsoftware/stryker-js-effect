import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { NpmLockfileJson } from '@systemfsoftware/stryker-e2e-core'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

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

const LOCK_FILE = 'package-lock.json'

const decodeEveryCommittedLock = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const resources = yield* path.fromFileUrl(RESOURCES_URL)
  const locks = Arr.filter(yield* fs.readDirectory(resources), (fixture) => fixture.endsWith('-fixture'))
  const outcomes = yield* Effect.forEach(locks, (fixture) =>
    Effect.map(
      fs.readFileString(path.join(resources, fixture, LOCK_FILE)),
      (text) => S.decodeResult(NpmLockfileJson)(text),
    ))
  return {
    locks: outcomes.length,
    packages: outcomes.flatMap((outcome) =>
      Result.match(outcome, {
        onFailure: () => [],
        onSuccess: (lock) => Object.keys(lock.packages),
      })
    ).length,
    refused: outcomes.flatMap((outcome) =>
      Result.match(outcome, { onFailure: (error) => [error.message], onSuccess: () => [] })
    ),
  }
})

const refusalOf = (text: string): string =>
  Result.match(S.decodeResult(NpmLockfileJson)(text), {
    onFailure: (error) => error.message,
    onSuccess: () => 'decoded',
  })

Feature('Committed fixture locks agree with the repository')
  .withLayer(PORTS)
  .live('every e2e fixture lock matches the packed closure, the fixture manifests and pnpm-lock.yaml, offline')
  .body(({ scenario, scenarioOutline }) => {
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

    scenario(
      'Every committed fixture lock reads as an npm lockfile',
      Gherkin.Do.pipe(
        Given('the e2e fixtures under test/e2e/testResources')('resources', () => Effect.succeed(RESOURCES_URL.href)),
        When('each fixture package-lock.json is read')('read', () => decodeEveryCommittedLock),
        Then('every lock is read with its packages and none is refused')((s, expect) =>
          expect({ read: s.read.locks > 0 && s.read.packages > 0, refused: s.read.refused.join('\n') })
            .toStrictEqual({ read: true, refused: '' })
        ),
      ),
    )

    scenarioOutline(
      'A lock whose key must be escaped in JSON is refused and the refusal names that key',
      [
        {
          key: 'a lone surrogate',
          text: '{"lockfileVersion":3,"packages":{"node_modules/\\ud800":{}}}',
          at: 'at ["packages"]["node_modules/\\ud800"]',
        },
        {
          key: 'NUL',
          text: '{"lockfileVersion":3,"packages":{"\\u0000":{}}}',
          at: 'at ["packages"]["\\u0000"]',
        },
        {
          key: 'a trailing backslash',
          text: '{"lockfileVersion":3,"packages":{"":{"dependencies":{"x\\\\":"1.0.0"}}}}',
          at: 'at ["packages"][""]["dependencies"]["x\\\\"]',
        },
      ],
      ({ key, text, at }) =>
        Gherkin.Do.pipe(
          Given(`a package-lock.json with a key holding ${key}`)('text', () => Effect.succeed(text)),
          When('the lock is read')('refusal', (s) => Effect.succeed(refusalOf(s.text))),
          Then('the lock is refused at that key')((s, expect) => expect(s.refusal).toContain(at)),
        ),
    )
  })
