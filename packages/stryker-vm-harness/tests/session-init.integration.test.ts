import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Session } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'

const Feature = makeFeature({ it })

const suiteFileLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

interface SuiteOnDisk {
  readonly directory: string
  readonly file: string
  readonly stubInstalled: boolean
}

const writeBareSuite = (): Effect.Effect<SuiteOnDisk, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const outer = yield* fs.makeTempDirectory()
    const directory = path.join(yield* fs.realPath(outer), 'isolated-sandbox')
    yield* fs.makeDirectory(directory, { recursive: true })
    const stubDir = path.join(directory, 'node_modules', 'vitest')
    yield* fs.makeDirectory(stubDir, { recursive: true })
    yield* fs.writeFileString(
      path.join(stubDir, 'package.json'),
      '{"name":"vitest","type":"module","exports":{"./nothing":"./nothing.js"}}\n',
    )
    const file = path.join(directory, 'suite-0.test.ts')
    yield* fs.writeFileString(file, "import { test } from 'vitest'\n\ntest('adds numbers', () => {})\n")
    const stubInstalled = yield* fs.exists(path.join(stubDir, 'package.json'))
    return { directory, file, stubInstalled }
  }).pipe(Effect.orDie)

Feature('Reporting a sandbox that cannot load vitest')
  .withScenarioLayer(suiteFileLayer)
  .live('the session boots a real sandbox directory and resolves the sandbox install from disk')
  .body(({ scenario }) => {
    scenario(
      'A sandbox whose vitest install cannot be loaded is refused with a message naming the sandbox',
      Gherkin.Do.pipe(
        Given('a written suite whose sandbox vitest cannot be loaded from')('suite', () => writeBareSuite()),
        When('the session checks the suite')(
          'response',
          (s) =>
            Effect.gen(function*() {
              const session = yield* Effect.promise(() =>
                Session.createVmSession({ sandboxWorkingDirectory: s.suite.directory, testFiles: [s.suite.file] }, [])
              )
              return yield* Effect.promise(() => session.run({ kind: 'dry', timeoutMs: 5000, reloadEnvironment: true }))
                .pipe(Effect.ensuring(Effect.promise(() => session.dispose())))
            }),
        ),
        Then('the run is refused before any test runs, naming vitest and the sandbox')((s, expect) => {
          const message = s.response.status === 'init-failed' ? s.response.message : ''
          return expect({
            stubInstalled: s.suite.stubInstalled,
            status: s.response.status,
            namesVitest: message.includes('vitest'),
            namesSandbox: message.includes(s.suite.directory),
          }).toEqual({ stubInstalled: true, status: 'init-failed', namesVitest: true, namesSandbox: true })
        }),
      ),
    )
  })
