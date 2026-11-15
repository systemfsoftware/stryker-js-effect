import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { Contract, ObservationWindow, Rel, Stimulus } from '@systemfsoftware/trace-spec'
import { type Span, Taxonomy } from '@systemfsoftware/trace-taxonomy'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as References from 'effect/References'
import * as Result from 'effect/Result'
import * as Stdio from 'effect/Stdio'

import {
  MutantRun,
  SandboxAcquire as Acquire,
  SandboxBuildRun as Build,
  SandboxFindNodeModules as Find,
  SandboxLinkNodeModules as Link,
  SandboxRestoreOriginal as Restore,
  SandboxSymlinkNodeModules as Symlink,
} from './__fixtures__/declared-spans.fixture.js'
import { finishedBeforeStart, nearestWatchedAncestor } from './__fixtures__/trace-relations.fixture.js'

const PACKAGE_MODULES = decodeURIComponent(new URL('../node_modules', import.meta.url).pathname)

const Feature = makeFeature({ it })

const TEMP_DIR_NAME = '.stryker-tmp'
const SOURCE = 'export const add = (left: number, right: number): number => left + right\n'
const START_SYMLINK = 'Start symlink node_modules'

const WATCHED = [Acquire, Build, Symlink, Find, Link] as const

const SandboxAcquisition = Taxonomy.make('sandbox-acquisition').pipe(
  Taxonomy.add(Acquire),
  Taxonomy.add(Build),
  Taxonomy.add(Symlink),
  Taxonomy.add(Find),
  Taxonomy.add(Link),
  Taxonomy.add(Restore),
  Taxonomy.add(MutantRun),
)

const TEST = [
  "import { expect, test } from 'vitest'",
  "import { add } from '../src/math.ts'",
  '',
  "test('adds one and one', () => {",
  '  expect(add(1, 1)).toBe(2)',
  '})',
].join('\n')

interface RunObservation {
  readonly succeeded: boolean
  readonly startSymlinkLogs: number
}

const writeProject = (): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-sandbox-acquisition-' }))
    yield* fs.symlink(PACKAGE_MODULES, path.join(root, 'node_modules'))
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.makeDirectory(path.join(root, 'test'), { recursive: true })
    yield* fs.makeDirectory(path.join(root, 'node_modules', 'left-pad'), { recursive: true })
    yield* fs.writeFileString(path.join(root, 'src/math.ts'), SOURCE)
    yield* fs.writeFileString(path.join(root, 'test/math.test.mjs'), TEST)
    yield* fs.writeFileString(path.join(root, 'node_modules/left-pad/package.json'), '{ "name": "left-pad" }\n')
    return root
  })

const removeProject = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.remove(root, { recursive: true }))))

interface AcquisitionRequest {
  readonly root: string
  readonly options: Options.PartialStrykerOptions
}

const runInProject = Stimulus.make({
  name: 'stryker.run_in_project',
  run: (
    { input }: { readonly input: AcquisitionRequest },
  ): Effect.Effect<RunObservation, PlatformError, Engine.EnginePorts | FileSystem.FileSystem | Path.Path> => {
    const logs: Array<string> = []
    const logging = Logger.layer([Logger.make((entry) => logs.push([entry.message].flat().map(String).join(' ')))])
    return Effect.gen(function*() {
      const succeeded = yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          const previous = globalThis.process.cwd()
          globalThis.process.chdir(input.root)
          return previous
        }),
        () =>
          Effect.result(Engine.strykerCell({
            testRunner: 'vm',
            testFiles: ['test/**/*.mjs'],
            mutate: ['src/**/*.ts'],
            reporters: [],
            checkers: [],
            tempDirName: TEMP_DIR_NAME,
            cleanTempDir: false,
            ...input.options,
          })).pipe(
            Effect.map(Result.isSuccess),
            Effect.provide(logging),
            Effect.provideService(References.MinimumLogLevel, 'Debug'),
          ),
        (previous) =>
          Effect.sync(() => {
            globalThis.process.chdir(previous)
          }),
      )
      return { succeeded, startSymlinkLogs: logs.filter((message) => message === START_SYMLINK).length }
    }).pipe(Effect.ensuring(removeProject(input.root)))
  },
})

type Placement = ReadonlyArray<readonly [child: Span.Span, parent: Span.Span | undefined]>

const acquisitionPlacedInside = (placement: Placement): ReadonlyArray<Rel.Relation> => [
  ...WATCHED.filter((span) => !placement.some(([child]) => child.name === span.name)).map((span) => Rel.absent(span)),
  ...placement.flatMap(([child, parent]) => [
    Rel.unique(child),
    nearestWatchedAncestor({ watched: WATCHED, child, parent }),
  ]),
]

const COPIED_LINKED_CLAIMS = Rel.all(
  ...acquisitionPlacedInside([
    [Acquire, undefined],
    [Build, Acquire],
    [Find, Symlink],
    [Link, Symlink],
    [Symlink, Acquire],
  ]),
  Rel.order(Build, Symlink),
  Rel.absent(Restore),
)

const COPIED_UNLINKED_CLAIMS = Rel.all(
  ...acquisitionPlacedInside([[Acquire, undefined], [Symlink, Acquire]]),
  Rel.absent(Restore),
)

const IN_PLACE_CLAIMS = Rel.all(
  ...acquisitionPlacedInside([[Acquire, undefined], [Build, Acquire], [Symlink, Acquire]]),
  Rel.order(Build, Symlink),
  Rel.unique(Restore),
  Rel.exists(MutantRun),
  finishedBeforeStart({ before: MutantRun, after: Restore }),
)

const acquisitionContract = (claims: Rel.Relation) =>
  Contract.of(SandboxAcquisition).stimulate(runInProject).holds(claims)

const runLayer = Layer.mergeAll(
  Engine.nodePlatformLayer,
  Stdio.layerTest({}),
  ObservationWindow.make('sandbox-acquisition-test').layer,
  NodeFileSystem.layer,
)

Feature('Tracing how a mutation run acquires its sandbox')
  .withLayer(runLayer)
  .live(
    'the scenarios run real mutation runs in a real project directory, and the trace observation window reads spans back from an OpenTelemetry exporter that schedules its export on a real timer',
  )
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'A <sandbox> run with <build> traces the build and the node_modules link inside the acquisition',
      [
        {
          sandbox: 'copied',
          build: 'a build command and linked node_modules',
          options: { buildCommand: 'exit 0', symlinkNodeModules: true },
          contract: acquisitionContract(COPIED_LINKED_CLAIMS),
        },
        {
          sandbox: 'copied',
          build: 'no build command and unlinked node_modules',
          options: { symlinkNodeModules: false },
          contract: acquisitionContract(COPIED_UNLINKED_CLAIMS),
        },
        {
          sandbox: 'in-place',
          build: 'a build command and node_modules linking asked for',
          options: { buildCommand: 'exit 0', symlinkNodeModules: true, inPlace: true },
          contract: acquisitionContract(IN_PLACE_CLAIMS),
        },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project with one source file, one passing test and a node_modules folder')(
            'root',
            () => writeProject(),
          ),
          When(`the mutation run finishes in a ${row.sandbox} sandbox`)('judged', (s) =>
            Contract.judge(row.contract, { root: s.root, options: row.options })),
          Then(
            'the build runs before the link, both inside the acquisition span, and an in-place run restores its original files only after every mutant has run',
          )((s, expect) =>
            Contract.verdictCheck(row.contract, expect, s.judged)
          ),
          When('the outcome of the run is read back')('run', (s) => Effect.succeed(s.judged.run.output)),
          Then('the run succeeded and the link step logged its start once')((s, expect) =>
            expect(s.run).toEqual({ succeeded: true, startSymlinkLogs: 1 })
          ),
        ),
    )
  })
