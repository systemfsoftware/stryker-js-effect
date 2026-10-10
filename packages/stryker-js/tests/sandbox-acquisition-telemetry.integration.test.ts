import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { InMemorySpanExporter, type ReadableSpan, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as References from 'effect/References'
import * as Result from 'effect/Result'
import * as Stdio from 'effect/Stdio'

const Feature = makeFeature({ it })

const TEMP_DIR_NAME = '.stryker-tmp'
const SOURCE = 'export const add = (left: number, right: number): number => left + right\n'
const START_SYMLINK = 'Start symlink node_modules'

const ACQUIRE = 'stryker.sandbox.acquire'
const BUILD = 'stryker.sandbox.build.run'
const SYMLINK = 'stryker.sandbox.symlink_node_modules'
const FIND = 'stryker.sandbox.find_node_modules'
const LINK = 'stryker.sandbox.link_node_modules'
const RESTORE = 'stryker.sandbox.restore_original'
const MUTANT_RUN = 'stryker.mutant_run'
const WATCHED: ReadonlyArray<string> = [ACQUIRE, BUILD, SYMLINK, FIND, LINK]

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
  readonly tree: ReadonlyArray<string>
  readonly stepOrder: ReadonlyArray<string>
  readonly startSymlinkLogs: number
  readonly restores: number
  readonly restoredAfterEveryMutantRun: boolean
}

const writeProject = (): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-sandbox-acquisition-' }))
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

const nearestWatchedAncestor = (span: ReadableSpan, byId: ReadonlyMap<string, ReadableSpan>): string => {
  const parent = byId.get(span.parentSpanContext?.spanId ?? '')
  return parent === undefined
    ? 'nothing'
    : WATCHED.includes(parent.name)
    ? parent.name
    : nearestWatchedAncestor(parent, byId)
}

const treeOf = (spans: ReadonlyArray<ReadableSpan>): ReadonlyArray<string> => {
  const byId = new Map(spans.map((span) => [span.spanContext().spanId, span] as const))
  return spans
    .filter((span) => WATCHED.includes(span.name))
    .map((span) => `${span.name} inside ${nearestWatchedAncestor(span, byId)}`)
    .toSorted()
}

const nanosOf = ([seconds, nanos]: ReadableSpan['startTime']): number => seconds * 1e9 + nanos

const stepOrderOf = (spans: ReadonlyArray<ReadableSpan>): ReadonlyArray<string> =>
  spans
    .filter((span) => span.name === BUILD || span.name === SYMLINK)
    .toSorted((left, right) => nanosOf(left.startTime) - nanosOf(right.startTime))
    .map((span) => span.name)

const restoredAfterEveryMutantRun = (spans: ReadonlyArray<ReadableSpan>): boolean => {
  const mutantRunEnds = spans.filter((span) => span.name === MUTANT_RUN).map((span) => nanosOf(span.endTime))
  const restoreStarts = spans.filter((span) => span.name === RESTORE).map((span) => nanosOf(span.startTime))
  return mutantRunEnds.length > 0 && restoreStarts.length > 0 &&
    restoreStarts.every((start) => mutantRunEnds.every((end) => start >= end))
}

const observeRun = (
  root: string,
  options: Options.PartialStrykerOptions,
): Effect.Effect<RunObservation, PlatformError, Engine.EnginePorts | FileSystem.FileSystem | Path.Path> => {
  const exporter = new InMemorySpanExporter()
  const telemetry = NodeSdk.layer(() => ({
    resource: { serviceName: 'sandbox-acquisition-test' },
    spanProcessor: new SimpleSpanProcessor(exporter),
  }))
  const logs: Array<string> = []
  const logging = Logger.layer([Logger.make((entry) => logs.push([entry.message].flat().map(String).join(' ')))])
  return Effect.gen(function*() {
    const { succeeded, spans } = yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = globalThis.process.cwd()
        globalThis.process.chdir(root)
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
          ...options,
        })).pipe(
          Effect.map((result) => ({ succeeded: Result.isSuccess(result), spans: exporter.getFinishedSpans() })),
          Effect.provide(Layer.mergeAll(telemetry, logging)),
          Effect.provideService(References.MinimumLogLevel, 'Debug'),
        ),
      (previous) =>
        Effect.sync(() => {
          globalThis.process.chdir(previous)
        }),
    )
    return {
      succeeded,
      tree: treeOf(spans),
      stepOrder: stepOrderOf(spans),
      startSymlinkLogs: logs.filter((message) => message === START_SYMLINK).length,
      restores: spans.filter((span) => span.name === RESTORE).length,
      restoredAfterEveryMutantRun: restoredAfterEveryMutantRun(spans),
    }
  }).pipe(Effect.ensuring(removeProject(root)))
}

const COPIED_LINKED_TREE = [
  `${ACQUIRE} inside nothing`,
  `${BUILD} inside ${ACQUIRE}`,
  `${FIND} inside ${SYMLINK}`,
  `${LINK} inside ${SYMLINK}`,
  `${SYMLINK} inside ${ACQUIRE}`,
]

const COPIED_UNLINKED_TREE = [`${ACQUIRE} inside nothing`, `${SYMLINK} inside ${ACQUIRE}`]

const IN_PLACE_TREE = [`${ACQUIRE} inside nothing`, `${BUILD} inside ${ACQUIRE}`, `${SYMLINK} inside ${ACQUIRE}`]

const runLayer = Layer.mergeAll(Engine.nodePlatformLayer, Stdio.layerTest({}))

Feature('Tracing how a mutation run acquires its sandbox')
  .withLayer(runLayer)
  .live(
    'the scenarios run real mutation runs in a real project directory, and the OpenTelemetry span exporter schedules its export on a real timer',
  )
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'A <sandbox> run with <build> traces the build and the node_modules link inside the acquisition',
      [
        {
          sandbox: 'copied',
          build: 'a build command and linked node_modules',
          options: { buildCommand: 'exit 0', symlinkNodeModules: true },
          observation: {
            succeeded: true,
            tree: COPIED_LINKED_TREE,
            stepOrder: [BUILD, SYMLINK],
            startSymlinkLogs: 1,
            restores: 0,
            restoredAfterEveryMutantRun: false,
          },
        },
        {
          sandbox: 'copied',
          build: 'no build command and unlinked node_modules',
          options: { symlinkNodeModules: false },
          observation: {
            succeeded: true,
            tree: COPIED_UNLINKED_TREE,
            stepOrder: [SYMLINK],
            startSymlinkLogs: 1,
            restores: 0,
            restoredAfterEveryMutantRun: false,
          },
        },
        {
          sandbox: 'in-place',
          build: 'a build command and node_modules linking asked for',
          options: { buildCommand: 'exit 0', symlinkNodeModules: true, inPlace: true },
          observation: {
            succeeded: true,
            tree: IN_PLACE_TREE,
            stepOrder: [BUILD, SYMLINK],
            startSymlinkLogs: 1,
            restores: 1,
            restoredAfterEveryMutantRun: true,
          },
        },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project with one source file, one passing test and a node_modules folder')(
            'root',
            () => writeProject(),
          ),
          When(`the mutation run finishes in a ${row.sandbox} sandbox`)('observed', (s) =>
            observeRun(s.root, row.options)),
          Then(
            'the build runs before the link, both inside the acquisition span, the link step logs its start once, and an in-place run restores its original files only after every mutant has run',
          )((s, expect) =>
            expect(s.observed).toEqual(row.observation)
          ),
        ),
    )
  })
