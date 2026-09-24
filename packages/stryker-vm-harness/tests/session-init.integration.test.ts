import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { And, Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { createVmSession } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const suiteFileLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

interface SuiteOnDisk {
  readonly directory: string
  readonly file: string
}

const writeBareSuite = (): Effect.Effect<SuiteOnDisk, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const outer = yield* fs.makeTempDirectory()
    const directory = path.join(outer, 'isolated-sandbox')
    yield* fs.makeDirectory(directory, { recursive: true })
    const stubDir = path.join(directory, 'node_modules', 'vitest')
    yield* fs.makeDirectory(stubDir, { recursive: true })
    yield* fs.writeFileString(
      path.join(stubDir, 'package.json'),
      '{"name":"vitest","type":"module","exports":{"./nothing":"./nothing.js"}}\n',
    )
    const file = path.join(directory, 'suite-0.test.ts')
    yield* fs.writeFileString(file, "import { test } from 'vitest'\n\ntest('adds numbers', () => {})\n")
    return { directory, file }
  }).pipe(Effect.orDie)
Feature('Reporting a sandbox that cannot load vitest')
  .withScenarioLayer(suiteFileLayer)
  .liveClock()
  .body(({ scenario }) => {
    scenario(
      'A sandbox whose vitest install cannot be loaded is refused with a message naming the sandbox',
      Gherkin.Do.pipe(
        Given('a written suite whose sandbox vitest cannot be loaded from')(
          'suite',
          () =>
            writeBareSuite().pipe(
              Effect.tap((suite) =>
                Effect.gen(function*() {
                  const fs = yield* FileSystem.FileSystem
                  const path = yield* Path.Path
                  const stubInstalled = yield* fs.exists(
                    path.join(suite.directory, 'node_modules', 'vitest', 'package.json'),
                  )
                  expect(stubInstalled).toBe(true)
                })
              ),
            ),
        ),
        When('the session checks the suite')(
          'response',
          (s) =>
            Effect.gen(function*() {
              const session = yield* Effect.promise(() =>
                createVmSession({ sandboxWorkingDirectory: s.suite.directory, testFiles: [s.suite.file] }, [])
              )
              return yield* Effect.promise(() => session.run({ kind: 'dry', timeoutMs: 5000, reloadEnvironment: true }))
                .pipe(Effect.ensuring(Effect.promise(() => session.dispose())))
            }),
        ),
        Then('the run is refused before any test runs')((s) => {
          expect(s.response.status).toBe('init-failed')
        }),
        And('the refusal says vitest could not be resolved and names the sandbox')((s) => {
          if (s.response.status === 'init-failed') {
            expect(s.response.message).toContain('vitest')
            expect(s.response.message).toContain(s.suite.directory)
            return
          }
          throw new Error('the sandbox unexpectedly resolved vitest without linked dependencies')
        }),
      ),
    )
  })
