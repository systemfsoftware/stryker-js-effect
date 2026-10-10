import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const SOURCE = 'export const add = (left: number, right: number): number => left + right\n'

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

const writeFixture = (): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory()
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.writeFileString(path.join(root, 'src', 'math.ts'), SOURCE)
    return root
  }).pipe(Effect.orDie)

const removeFixture = (root: string): Effect.Effect<void, never, never> =>
  Effect.provide(
    Effect.orDie(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true }))),
    filePorts,
  )

const optionsOf = (root: string, commandRunner: string): Options.PartialStrykerOptions => ({
  testRunner: 'command',
  commandRunner: { command: commandRunner },
  coverageAnalysis: 'off',
  reporters: [],
  mutate: ['src/**/*.ts'],
  checkers: [],
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: `${root}/reports/main.json`,
})

const REUSED_LINE = 'Reusing the persisted dry-run coverage'
const REFUSED_LINE = 'dry-run coverage reuse refused'

interface RunObservation {
  readonly report: string
  readonly reused: boolean
  readonly refused: boolean
}

const runOnce = (
  root: string,
  spawnLog: string,
): Effect.Effect<RunObservation, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Engine.nodePlatformLayer
    const logs: string[] = []
    const layer = Layer.mergeAll(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(root), queue), ports),
      ports,
      Logger.layer([
        Logger.make((entry) => {
          logs.push([entry.message].flat().map(String).join(' '))
        }),
      ]),
    )
    yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root, `echo spawned >> ${spawnLog}`), targetMutatePatterns: undefined })
      .pipe(Effect.provide(layer), Effect.scoped, Effect.orDie)
    return {
      report: yield* fs.readFileString(path.join(root, 'reports', 'main.json')).pipe(Effect.orElseSucceed(() => '')),
      reused: logs.some((line) => line.includes(REUSED_LINE)),
      refused: logs.some((line) => line.includes(REFUSED_LINE)),
    }
  }).pipe(Effect.provide(filePorts), Effect.orDie)

const documentOf = (report: string): Option.Option<Record<string, S.Json>> =>
  S.decodeOption(S.fromJsonString(S.Record(S.String, S.Json)))(report)

const versionOf = (report: string): string =>
  Option.getOrElse(
    Option.flatMap(documentOf(report), (document) =>
      Option.filter(Option.fromNullishOr(document['incrementalVersion']), S.is(S.String))),
    () =>
      '',
  )

const otherVersionReportOf = (report: string): string =>
  Option.getOrElse(
    Option.map(
      documentOf(report),
      (document) => JSON.stringify({ ...document, incrementalVersion: `${versionOf(report)}-other` }),
    ),
    () => report,
  )

Feature('Dry-run coverage reuse is gated on the incremental cache version')
  .withLayer(Layer.empty)
  .live('the scenario drives the real engine over the host filesystem, so the reports and roots are the real ones')
  .body(({ scenario }) => {
    scenario(
      'An incremental file that names another cache version loses the coverage its own version keeps',
      Gherkin.Do.pipe(
        Given('a workspace that ran, reused its coverage, then had only the header version rewritten')(
          'observed',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const spawnLog = yield* fs.makeTempFile({ prefix: 'version-gate-spawns', suffix: '.log' })
              const root = yield* writeFixture()
              const reportFile = path.join(root, 'reports', 'main.json')
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  yield* runOnce(root, spawnLog)
                  const keptVersion = yield* runOnce(root, spawnLog)
                  yield* fs.writeFileString(reportFile, otherVersionReportOf(keptVersion.report))
                  const rewrittenVersion = yield* runOnce(root, spawnLog)
                  return { keptVersion, rewrittenVersion, versionNamesOther: versionOf(keptVersion.report) !== '' }
                }),
                Effect.andThen(removeFixture(root), Effect.orDie(fs.remove(spawnLog, { force: true }))),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the matching version reuses the coverage while the rewritten one refuses it')((s, expect) =>
          expect({
            versionNamesOther: s.observed.versionNamesOther,
            keptVersion: { reused: s.observed.keptVersion.reused, refused: s.observed.keptVersion.refused },
            rewrittenVersion: {
              reused: s.observed.rewrittenVersion.reused,
              refused: s.observed.rewrittenVersion.refused,
            },
          }).toEqual({
            versionNamesOther: true,
            keptVersion: { reused: true, refused: false },
            rewrittenVersion: { reused: false, refused: true },
          })
        ),
      ),
    )
  })
