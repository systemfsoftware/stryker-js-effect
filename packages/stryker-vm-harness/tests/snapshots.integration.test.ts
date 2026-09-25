import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Assertions, Sandbox, Session } from '@systemfsoftware/stryker-vm-harness'
import { FileSystem, Path, PlatformError } from 'effect'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const Feature = makeFeature({ it })

interface HandedOutExpect {
  readonly any: (constructor: object) => object
  readonly addSnapshotSerializer: (...args: readonly object[]) => void
}

interface VitestExpectModule {
  readonly expect: HandedOutExpect
}

const { expect: vitestExpect } = await Sandbox.nativeImport<VitestExpectModule>('vitest')

const ACCEPTED = 'accepted'
const VITEST_HEADER = '// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html'
const OBJECT_RECORD = '\n{\n  "alpha": 1,\n}\n'
const PINNED_RECORD = '\n{\n  "id": Any<Number>,\n  "name": "gear",\n}\n'

const storedFormOf = (entries: ReadonlyArray<readonly [name: string, value: string]>): string =>
  `${VITEST_HEADER}\n\n${entries.map(([name, value]) => `exports[\`${name}\`] = \`${value}\`;`).join('\n\n')}\n`

interface SuiteAssertion {
  readonly toMatchSnapshot: (...args: readonly (object | string)[]) => void
  readonly toMatchInlineSnapshot: (...args: readonly (object | string)[]) => void
  readonly toThrowErrorMatchingSnapshot: () => void
  readonly toThrowErrorMatchingInlineSnapshot: (...args: readonly (object | string)[]) => void
  readonly toMatchFileSnapshot: (path: string) => object
}

const isExpectCall = (value: object): value is (received: object | string) => SuiteAssertion =>
  typeof value === 'function'

const asSuiteAssertion = (handedOut: object, received: object | string): SuiteAssertion => {
  if (!isExpectCall(handedOut)) {
    throw new Error('the handed-out assertion helper is not callable')
  }
  return handedOut(received)
}

interface MatcherHost {
  readonly any: (constructor: object) => object
}

const matcherHost: MatcherHost = vitestExpect

interface SuiteSerializer {
  readonly test: (value: object) => boolean
  readonly print: (value: object) => string
}

const matchesSealKind = (value: object): boolean => 'kind' in value

interface SuiteRun {
  readonly dir: string
  readonly testFile: string
  readonly snapshotFile: string
  readonly handedOut: object
  readonly support: Session.SnapshotSupport
}

const hostOf = (dir: string) => ({
  sandboxWorkingDirectory: dir,
  options: { sandboxWorkingDirectory: dir, testFiles: [] },
  state: { read: () => undefined, write: () => undefined },
  resolveVitest: () => ({ expect: vitestExpect, vi: undefined }),
  resolveVitestModule: (specifier: string) => import.meta.resolve(specifier),
  importFile: () => Promise.resolve(),
})

const suiteRunOf = (
  ci: string,
): Effect.Effect<SuiteRun, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fileSystem.makeTempDirectory({ prefix: 'vm-snapshots-' })
    const testFile = path.join(dir, 'suite.test.ts')
    yield* fileSystem.writeFileString(testFile, '')
    const support = yield* Effect.promise(() => Session.createSnapshotSupport(hostOf(dir), { ci })).pipe(Effect.orDie)
    return {
      dir,
      testFile,
      snapshotFile: Session.defaultSnapshotPath(path, testFile),
      handedOut: Assertions.guardedExpect(vitestExpect),
      support,
    }
  })

const outcomeOf = (attempt: () => void | object): Promise<string> => {
  try {
    const attempted = attempt()
    if (attempted === undefined) {
      return Promise.resolve(ACCEPTED)
    }
    return Promise.resolve(attempted).then(
      () => ACCEPTED,
      (thrown: object) => (thrown instanceof Error ? thrown.message : 'a non-error was thrown'),
    )
  } catch (error) {
    return Promise.resolve(error instanceof Error ? error.message : 'a non-error was thrown')
  }
}

const comparedOn = (
  run: SuiteRun,
  runKind: 'dry' | 'mutant',
  name: string,
  received: object | string,
  attempt: (assertion: SuiteAssertion) => void | object,
): Promise<string> =>
  run.support
    .openFile(run.testFile)
    .then(() => {
      run.support.beginTest({ id: `${run.testFile}#${name}`, file: run.testFile, name }, runKind)
    })
    .then(() => outcomeOf(() => attempt(asSuiteAssertion(run.handedOut, received))))
    .then((outcome) => {
      run.support.endTest()
      return run.support.closeFile(run.testFile).then(() => outcome)
    })
    .catch((thrown: object) => {
      run.support.endTest()
      return thrown instanceof Error ? thrown.message : 'a non-error was thrown'
    })

const suiteRunWithStored = (
  name: string,
  received: object | string,
): Effect.Effect<SuiteRun, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.flatMap(suiteRunOf('false'), (run) =>
    Effect.map(
      Effect.promise(() =>
        comparedOn(run, 'dry', name, received, (assertion) => {
          assertion.toMatchSnapshot()
        })
      ).pipe(Effect.orDie),
      () => run,
    ))

const releaseSuiteRun = (
  run: SuiteRun,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fileSystem) => fileSystem.remove(run.dir, { recursive: true }))

Feature('Snapshot records kept by a suite that runs in memory')
  .withLayer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  .live('the snapshot support writes real files under a temporary sandbox directory')
  .body(({ scenario }) => {
    scenario(
      'A snapshot the suite has never kept is recorded by the dry run exactly as Vitest writes it',
      Gherkin.Do.pipe(
        Given('a suite whose dry run may record new snapshots')(
          'run',
          () => suiteRunOf('false'),
        ),
        When('the suite stores its value and the run finishes')(
          'outcome',
          (s) =>
            Effect.promise(() =>
              comparedOn(s.run, 'dry', 'only test', { alpha: 1 }, (assertion) => {
                assertion.toMatchSnapshot()
              })
            ),
        ),
        Then('the kept record is byte for byte the one Vitest itself writes')((s, expect) =>
          Effect.gen(function*() {
            const fileSystem = yield* FileSystem.FileSystem
            const stored = yield* fileSystem.readFileString(s.run.snapshotFile)
            return { stored }
          }).pipe(
            Effect.map(({ stored }) =>
              expect({ outcome: s.outcome, stored }).toEqual({
                outcome: ACCEPTED,
                stored: storedFormOf([['only test 1', OBJECT_RECORD]]),
              })
            ),
            Effect.ensuring(releaseSuiteRun(s.run).pipe(Effect.orDie)),
          )
        ),
      ),
    )

    scenario(
      'A mutant run compares against the stored records without writing them',
      Gherkin.Do.pipe(
        Given('a suite whose dry run stored its snapshot')(
          'run',
          () => suiteRunWithStored('only test', { alpha: 1 }),
        ),
        When('the same value is compared again while a mutant is active')(
          'compared',
          (s) =>
            Effect.gen(function*() {
              const fileSystem = yield* FileSystem.FileSystem
              return yield* Effect.promise(() =>
                comparedOn(s.run, 'mutant', 'only test', { alpha: 1 }, (assertion) => {
                  assertion.toMatchSnapshot()
                }).then((outcome) => ({ outcome, stored: fileSystem.readFileString(s.run.snapshotFile) }))
              )
            }),
        ),
        Then('it still matches and the stored record is untouched')((s, expect) =>
          Effect.gen(function*() {
            const stored = yield* s.compared.stored
            return { stored }
          }).pipe(
            Effect.map(({ stored }) =>
              expect({ outcome: s.compared.outcome, stored }).toEqual({
                outcome: ACCEPTED,
                stored: storedFormOf([['only test 1', OBJECT_RECORD]]),
              })
            ),
            Effect.ensuring(releaseSuiteRun(s.run).pipe(Effect.orDie)),
          )
        ),
      ),
    )

    scenario(
      'A value the mutation changed no longer matches its stored record',
      Gherkin.Do.pipe(
        Given('a suite whose dry run stored its snapshot')(
          'run',
          () => suiteRunWithStored('only test', { alpha: 1 }),
        ),
        When('the mutated value is compared against the stored record')(
          'compared',
          (s) =>
            Effect.gen(function*() {
              const fileSystem = yield* FileSystem.FileSystem
              return yield* Effect.promise(() =>
                comparedOn(s.run, 'mutant', 'only test', { alpha: 2 }, (assertion) => {
                  assertion.toMatchSnapshot()
                }).then((outcome) => ({ outcome, stored: fileSystem.readFileString(s.run.snapshotFile) }))
              )
            }),
        ),
        Then('the test refuses with a mismatch that names the record and keeps it stored')((s, expect) =>
          Effect.gen(function*() {
            const stored = yield* s.compared.stored
            return { stored }
          }).pipe(
            Effect.map(({ stored }) =>
              expect({ outcome: s.compared.outcome, stored }).toEqual({
                outcome: 'Snapshot `only test 1` mismatched',
                stored: storedFormOf([['only test 1', OBJECT_RECORD]]),
              })
            ),
            Effect.ensuring(releaseSuiteRun(s.run).pipe(Effect.orDie)),
          )
        ),
      ),
    )

    scenario(
      'A mutant run never stores a snapshot the suite has not kept yet',
      Gherkin.Do.pipe(
        Given('a mutant run over a suite with nothing stored')(
          'run',
          () => suiteRunOf('false'),
        ),
        When('the suite compares a value it has never stored')(
          'outcome',
          (s) =>
            Effect.promise(() =>
              comparedOn(s.run, 'mutant', 'only test', { alpha: 1 }, (assertion) => {
                assertion.toMatchSnapshot()
              })
            ),
        ),
        Then('the comparison passes and nothing was written beside the run')((s, expect) =>
          Effect.gen(function*() {
            const fileSystem = yield* FileSystem.FileSystem
            const stored = yield* fileSystem.exists(s.run.snapshotFile)
            return { stored }
          }).pipe(
            Effect.map(({ stored }) =>
              expect({ outcome: s.outcome, stored }).toEqual({ outcome: ACCEPTED, stored: false })
            ),
            Effect.ensuring(releaseSuiteRun(s.run).pipe(Effect.orDie)),
          )
        ),
      ),
    )

    scenario(
      'A run that refuses new snapshots fails on a snapshot the suite has never stored',
      Gherkin.Do.pipe(
        Given('a suite whose run refuses to record new snapshots')(
          'run',
          () => suiteRunOf('1'),
        ),
        When('the suite compares a value it has never stored')(
          'outcome',
          (s) =>
            Effect.promise(() =>
              comparedOn(s.run, 'dry', 'only test', { alpha: 1 }, (assertion) => {
                assertion.toMatchSnapshot()
              })
            ),
        ),
        Then('the test refuses with a mismatch that names the record')((s, expect) =>
          Effect.gen(function*() {
            const fileSystem = yield* FileSystem.FileSystem
            const stored = yield* fileSystem.exists(s.run.snapshotFile)
            return { stored }
          }).pipe(
            Effect.map(({ stored }) =>
              expect({ outcome: s.outcome, stored }).toEqual({
                outcome: 'Snapshot `only test 1` mismatched',
                stored: false,
              })
            ),
            Effect.ensuring(releaseSuiteRun(s.run).pipe(Effect.orDie)),
          )
        ),
      ),
    )

    scenario(
      'A value pinned partly by matchers keeps matching while the rest of it changes',
      Gherkin.Do.pipe(
        Given('a suite whose dry run may record new snapshots')(
          'run',
          () => suiteRunOf('false'),
        ),
        When('the suite pins part of its value and stores the record')(
          'outcome',
          (s) =>
            Effect.promise(() =>
              comparedOn(s.run, 'dry', 'pinned test', { id: 7, name: 'gear' }, (assertion) => {
                assertion.toMatchSnapshot({ id: matcherHost.any(Number), name: 'gear' })
              })
            ),
        ),
        Then('the kept record shows the pinned part beside the matching value')((s, expect) =>
          Effect.gen(function*() {
            const fileSystem = yield* FileSystem.FileSystem
            const stored = yield* fileSystem.readFileString(s.run.snapshotFile)
            return { stored }
          }).pipe(
            Effect.map(({ stored }) =>
              expect({ outcome: s.outcome, stored }).toEqual({
                outcome: ACCEPTED,
                stored: storedFormOf([['pinned test 1', PINNED_RECORD]]),
              })
            ),
            Effect.ensuring(releaseSuiteRun(s.run).pipe(Effect.orDie)),
          )
        ),
      ),
    )

    scenario(
      'An expectation the suite already wrote beside itself is compared in place',
      Gherkin.Do.pipe(
        Given('a suite whose dry run may record new snapshots')(
          'run',
          () => suiteRunOf('false'),
        ),
        When('the suite compares its value against the expectation written beside it')(
          'outcome',
          (s) =>
            Effect.promise(() =>
              comparedOn(s.run, 'dry', 'inline test', { alpha: 1 }, (assertion) => {
                assertion.toMatchInlineSnapshot('\n{\n  "alpha": 1,\n}\n')
              })
            ),
        ),
        Then('it matches and nothing extra was stored beside the run')((s, expect) =>
          Effect.gen(function*() {
            const fileSystem = yield* FileSystem.FileSystem
            const stored = yield* fileSystem.exists(s.run.snapshotFile)
            return { stored }
          }).pipe(
            Effect.map(({ stored }) =>
              expect({ outcome: s.outcome, stored }).toEqual({ outcome: ACCEPTED, stored: false })
            ),
            Effect.ensuring(releaseSuiteRun(s.run).pipe(Effect.orDie)),
          )
        ),
      ),
    )

    scenario(
      'A drifted inline expectation refuses with the stored key named',
      Gherkin.Do.pipe(
        Given('a suite whose dry run may record new snapshots')(
          'run',
          () => suiteRunOf('false'),
        ),
        When('the suite compares its value against a drifted inline expectation')(
          'outcome',
          (s) =>
            Effect.promise(() =>
              comparedOn(s.run, 'dry', 'inline test', { alpha: 1 }, (assertion) => {
                assertion.toMatchInlineSnapshot('\n{\n  "alpha": 2,\n}\n')
              })
            ),
        ),
        Then('the test refuses with a mismatch that names the record')((s, expect) =>
          Effect.sync(() => expect(s.outcome).toEqual('Snapshot `inline test 1` mismatched')).pipe(
            Effect.ensuring(releaseSuiteRun(s.run).pipe(Effect.orDie)),
          )
        ),
      ),
    )

    scenario(
      'A thrown message is compared against the expectation written beside it',
      Gherkin.Do.pipe(
        Given('a suite whose dry run may record new snapshots')(
          'run',
          () => suiteRunOf('false'),
        ),
        When('the suite compares a thrown message against its inline expectation')(
          'outcome',
          (s) =>
            Effect.promise(() =>
              comparedOn(s.run, 'dry', 'thrown test', (): never => {
                throw new Error('inline boom')
              }, (assertion) => {
                assertion.toThrowErrorMatchingInlineSnapshot('[Error: inline boom]')
              })
            ),
        ),
        Then('the thrown message matches')((s, expect) =>
          Effect.sync(() => expect(s.outcome).toEqual(ACCEPTED)).pipe(
            Effect.ensuring(releaseSuiteRun(s.run).pipe(Effect.orDie)),
          )
        ),
      ),
    )

    scenario(
      'A snapshot kept in its own file is compared by its path',
      Gherkin.Do.pipe(
        Given('a suite whose own snapshot file holds the rendered output')(
          'run',
          () =>
            Effect.gen(function*() {
              const fileSystem = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const run = yield* suiteRunOf('false')
              yield* fileSystem.writeFileString(path.join(run.dir, 'rendered.txt'), 'rendered output\nline two\n')
              return run
            }),
        ),
        When('the suite compares its output against that file')(
          'outcome',
          (s) =>
            Effect.promise(() =>
              comparedOn(
                s.run,
                'dry',
                'file test',
                'rendered output\nline two\n',
                (assertion) => assertion.toMatchFileSnapshot('./rendered.txt'),
              )
            ),
        ),
        Then('the output matches the kept file')((s, expect) =>
          Effect.sync(() => expect(s.outcome).toEqual(ACCEPTED)).pipe(
            Effect.ensuring(releaseSuiteRun(s.run).pipe(Effect.orDie)),
          )
        ),
      ),
    )

    scenario(
      'A serializer the suite registered shapes the kept record',
      Gherkin.Do.pipe(
        Given('a suite that taught the runner how to print its values')(
          'run',
          () =>
            Effect.map(suiteRunOf('false'), (run) => {
              Reflect.apply(vitestExpect.addSnapshotSerializer, vitestExpect, [
                {
                  test: matchesSealKind,
                  print: (value: object) => `Widget(${String(Reflect.get(value, 'kind'))})`,
                } satisfies SuiteSerializer,
              ])
              return run
            }),
        ),
        When('the suite stores one of those values')(
          'outcome',
          (s) =>
            Effect.promise(() =>
              comparedOn(s.run, 'dry', 'serialized test', { kind: 'gear', size: 4 }, (assertion) => {
                assertion.toMatchSnapshot()
              })
            ),
        ),
        Then('the kept record is written the way the suite prints it')((s, expect) =>
          Effect.gen(function*() {
            const fileSystem = yield* FileSystem.FileSystem
            const stored = yield* fileSystem.readFileString(s.run.snapshotFile)
            return { stored }
          }).pipe(
            Effect.map(({ stored }) =>
              expect({ outcome: s.outcome, stored }).toEqual({
                outcome: ACCEPTED,
                stored: storedFormOf([['serialized test 1', 'Widget(gear)']]),
              })
            ),
            Effect.ensuring(releaseSuiteRun(s.run).pipe(Effect.orDie)),
          )
        ),
      ),
    )
  })
