import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { CheckerRuntime, TypeScriptCheckerRuntime } from '@systemfsoftware/stryker-js-typescript-checker/runtime'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const FILE_PORTS = Layer.mergeAll(
  FILE_AND_PATH,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)),
)

type ImporterCheck = 'location-rule' | 'always'

type Services = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

interface Fixture {
  readonly tsconfigFile: string
  readonly wires: ReadonlyArray<Checker.CheckerMutantWire>
}

interface Run {
  readonly statuses: Readonly<Record<string, string>>
  readonly shortcuts: number
}

const INSTRUMENTER_OPTIONS: Instrument.InstrumenterOptions = {
  excludedMutations: [],
  ignorers: [],
  mutantSetPolicy: 'default',
  mutators: Mutator.selectMutators(Mutator.stockRegistry, []),
}

const isolatedDeclarationsFixture: Effect.Effect<Fixture, never, Services> = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const here = yield* pathService.fromFileUrl(new URL(import.meta.url))
  const directory = pathService.join(pathService.dirname(here), '..', '__fixtures__', 'isolated-declarations')
  const names = yield* fs.readDirectory(pathService.join(directory, 'src'))
  const sources = yield* Effect.forEach(names, (name) => {
    const fileName = pathService.join(directory, 'src', name)
    return Effect.map(fs.readFileString(fileName), (content) => ({ name: fileName, content, mutate: true }))
  })
  const instrumented = yield* Instrument.instrument(sources, INSTRUMENTER_OPTIONS)
  const wires = yield* S.decodeEffect(S.Array(Checker.CheckerMutantWire))(
    instrumented.mutants.map((mutant) => ({
      id: mutant.id,
      fileName: mutant.fileName,
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      location: mutant.location,
    })),
  )
  return { tsconfigFile: pathService.join(directory, 'tsconfig.json'), wires }
}).pipe(Effect.orDie)

const runOf = (fixture: Fixture, importerCheck: ImporterCheck): Effect.Effect<Run, never, Services> =>
  Effect.gen(function*() {
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({
      tsconfigFile: fixture.tsconfigFile,
      typescriptChecker: { importerCheck },
    })
    const exporter = new InMemorySpanExporter()
    const telemetry = NodeSdk.layer(() => ({
      resource: { serviceName: 'isolated-declarations-shortcut-test' },
      spanProcessor: new SimpleSpanProcessor(exporter),
    }))
    return yield* Effect.gen(function*() {
      const runtime = yield* CheckerRuntime
      const checker = yield* runtime.checker
      const results = yield* checker.check([...fixture.wires])
      const span = exporter.getFinishedSpans().find((found) =>
        found.name === SpanTaxonomy.Spans.typescriptCheckerCompilerCheck.name
      )
      return {
        statuses: Object.fromEntries(HashMap.toEntries(HashMap.map(results, (result) => result.status))),
        shortcuts: Number(span?.attributes['typescript.importer_shortcut.count'] ?? 0),
      }
    }).pipe(Effect.provide(TypeScriptCheckerRuntime.layer(options).pipe(Layer.provideMerge(telemetry))))
  }).pipe(Effect.orDie)

Feature('The shortcut gate fixture exercises the importer shortcut', { timeout: 240_000 })
  .withLayer(FILE_PORTS)
  .live('real tsgo checks every mutant of the isolatedDeclarations fixture the parity lane gates on')
  .body(({ scenario }) => {
    scenario(
      'Some fixture mutants are decided by the shortcut with the verdicts of a full importer check',
      Gherkin.Do.pipe(
        When('every mutant of the fixture is checked once per importerCheck value')(
          'seen',
          () =>
            Effect.flatMap(isolatedDeclarationsFixture, (fixture) =>
              Effect.map(
                Effect.all({ rule: runOf(fixture, 'location-rule'), always: runOf(fixture, 'always') }),
                (runs) => ({ ...runs, mutants: fixture.wires.length }),
              )),
        ),
        Then('the shortcut decides at least one mutant and every verdict matches the always run')((s, expect) =>
          expect({
            shortcutTaken: s.seen.rule.shortcuts > 0,
            checked: Object.keys(s.seen.rule.statuses).length,
            statuses: s.seen.rule.statuses,
          }).toEqual({
            shortcutTaken: true,
            checked: s.seen.mutants,
            statuses: s.seen.always.statuses,
          })
        ),
      ),
    )
  })
