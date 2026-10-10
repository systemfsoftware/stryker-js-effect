import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import { InMemorySpanExporter, type ReadableSpan, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Checker, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { CheckerRuntime } from '@systemfsoftware/stryker-js-typescript-checker/runtime'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
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

interface Edit {
  readonly id: string
  readonly file: string
  readonly target: string
  readonly replacement: string
}

interface Run {
  readonly statuses: Readonly<Record<string, string>>
  readonly blamed: Readonly<Record<string, ReadonlyArray<string>>>
  readonly shortcutCounts: Readonly<Record<string, number>>
  readonly snapshotUpdates: number
}

const AE1 = '00000000000000a1'
const AE2 = '00000000000000a2'
const AE3 = '00000000000000a3'
const AE4 = '00000000000000a4'
const AE5 = '00000000000000a5'
const AE7 = '00000000000000a7'
const AE8 = '00000000000000a8'
const AE9 = '00000000000000a9'
const AE10 = '0000000000000a10'

interface Fixture {
  readonly directory: string
  readonly files: ReadonlyArray<string>
}

const SINGLE_PROJECT: Fixture = {
  directory: 'importer-shortcut',
  files: [
    'annotated.ts',
    'box.ts',
    'closer.ts',
    'consumer.ts',
    'contextual.ts',
    'defaults.ts',
    'inferred.ts',
    'loader.ts',
  ],
}

const REFERENCED_PROJECT: Fixture = {
  directory: 'importer-shortcut-references',
  files: ['lib/src/counter.ts', 'app/src/consumer.ts'],
}

const AE1_EDIT: Edit = { id: AE1, file: 'annotated.ts', target: 'x + 1', replacement: 'x - 1' }
const AE5_EDIT: Edit = { id: AE5, file: 'closer.ts', target: 'return x', replacement: 'return -x' }

const RULE_EDITS: ReadonlyArray<Edit> = [
  AE1_EDIT,
  { id: AE2, file: 'inferred.ts', target: 'return doubled', replacement: 'return String(doubled)' },
  { id: AE3, file: 'defaults.ts', target: '1', replacement: '""' },
  { id: AE4, file: 'loader.ts', target: "'./annotated.js'", replacement: "''" },
  {
    id: AE7,
    file: 'closer.ts',
    target: 'return x',
    replacement: 'return x\n}\nexport function closed(): string {\n  return ""',
  },
  { id: AE8, file: 'contextual.ts', target: 'x + 1', replacement: 'String(x)' },
  { id: AE9, file: 'box.ts', target: 'this.items.length', replacement: '""' },
]

const positionOf = (text: string, offset: number): Checker.CheckerMutantWire['location']['start'] => {
  const before = text.slice(0, offset).split('\n')
  return { line: before.length, column: (before.at(-1) ?? '').length + 1 }
}

const wireOf = (texts: HashMap.HashMap<string, string>, join: (name: string) => string) => (edit: Edit) => {
  const text = Option.getOrElse(HashMap.get(texts, edit.file), () => '')
  const start = text.indexOf(edit.target)
  return {
    id: edit.id,
    fileName: join(edit.file),
    mutatorName: 'ImporterShortcutProbe',
    replacement: edit.replacement,
    location: { start: positionOf(text, start), end: positionOf(text, start + edit.target.length) },
  }
}

const blamedFilesOf = (fixture: Fixture) => (result: Checker.CheckResult): ReadonlyArray<string> =>
  result.status === 'compileError'
    ? fixture.files.filter((file) => result.reason.includes(file))
    : []

const SHORTCUT_PREFIX = 'typescript.importer_shortcut.'

type SpanAttributes = ReadableSpan['attributes']

const checkSpanAttributesOf = (exporter: InMemorySpanExporter): SpanAttributes => {
  const span = exporter.getFinishedSpans().find((found) =>
    found.name === SpanTaxonomy.Spans.typescriptCheckerCompilerCheck.name
  )
  return span === undefined ? {} : span.attributes
}

interface Checked {
  readonly results: HashMap.HashMap<string, Checker.CheckResult>
  readonly attributes: SpanAttributes
}

interface CheckerOptionsInput {
  readonly typescriptChecker?: { readonly importerCheck: string | number }
}

const checkedWith = (
  fixture: Fixture,
  edits: ReadonlyArray<Edit>,
  checkerOptions: CheckerOptionsInput,
): Effect.Effect<
  Checked,
  Checker.CheckerFailed,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const here = yield* pathService.fromFileUrl(new URL(import.meta.url)).pipe(Effect.orDie)
    const directory = pathService.join(pathService.dirname(here), '__fixtures__', fixture.directory)
    const join = (name: string) => pathService.join(directory, name)
    const texts = HashMap.fromIterable(
      yield* Effect.forEach(
        fixture.files,
        (file) => Effect.map(fs.readFileString(join(file)), (text) => [file, text] as const),
      ).pipe(Effect.orDie),
    )
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({
      tsconfigFile: join('tsconfig.json'),
      ...checkerOptions,
    }).pipe(Effect.orDie)
    const wires = yield* S.decodeEffect(S.Array(Checker.CheckerMutantWire))(edits.map(wireOf(texts, join))).pipe(
      Effect.orDie,
    )
    const exporter = new InMemorySpanExporter()
    const telemetry = NodeSdk.layer(() => ({
      resource: { serviceName: 'importer-shortcut-test' },
      spanProcessor: new SimpleSpanProcessor(exporter),
    }))
    return yield* Effect.gen(function*() {
      const runtime = yield* CheckerRuntime
      const checker = yield* runtime.checker.pipe(Effect.orDie)
      const results = yield* checker.check([...wires])
      return { results, attributes: checkSpanAttributesOf(exporter) }
    }).pipe(Effect.provide(CheckerRuntime.layer(options).pipe(Layer.provideMerge(telemetry))))
  })

const shortcutCountsOf = (attributes: SpanAttributes): Readonly<Record<string, number>> =>
  Object.fromEntries(
    Object.entries(attributes)
      .filter(([key]) => key.startsWith(SHORTCUT_PREFIX))
      .map(([key, value]) => [key.slice(SHORTCUT_PREFIX.length), Number(value)]),
  )

const runOf = (
  fixture: Fixture,
  edits: ReadonlyArray<Edit>,
  importerCheck: ImporterCheck,
): Effect.Effect<Run, never, FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.map(checkedWith(fixture, edits, { typescriptChecker: { importerCheck } }), ({ results, attributes }) => {
    const resultOf = (id: string) => HashMap.get(results, id)
    return {
      statuses: Object.fromEntries(
        edits.map((
          edit,
        ) => [edit.id, Option.match(resultOf(edit.id), { onNone: () => 'missing', onSome: (r) => r.status })]),
      ),
      blamed: Object.fromEntries(
        edits.map((
          edit,
        ) => [edit.id, Option.match(resultOf(edit.id), { onNone: () => [], onSome: blamedFilesOf(fixture) })]),
      ),
      shortcutCounts: shortcutCountsOf(attributes),
      snapshotUpdates: Number(attributes['typescript.snapshot_updates.count'] ?? -1),
    }
  }).pipe(Effect.orDie)

type OptionOutcome =
  | { readonly refused: { readonly mutantIds: ReadonlyArray<string>; readonly invalidOptions: boolean } }
  | { readonly status: string; readonly shortcuts: number }

const INVALID_OPTIONS_TEXT = 'The typescriptChecker options are invalid'

const optionOutcomeOf = (
  checkerOptions: CheckerOptionsInput,
): Effect.Effect<OptionOutcome, never, FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner> =>
  checkedWith(SINGLE_PROJECT, [AE1_EDIT], checkerOptions).pipe(
    Effect.match({
      onFailure: (failed): OptionOutcome => ({
        refused: { mutantIds: [...failed.mutantIds], invalidOptions: failed.cause.includes(INVALID_OPTIONS_TEXT) },
      }),
      onSuccess: ({ results, attributes }): OptionOutcome => ({
        status: Option.match(HashMap.get(results, AE1), { onNone: () => 'missing', onSome: (r) => r.status }),
        shortcuts: shortcutCountsOf(attributes)['count'] ?? -1,
      }),
    }),
  )

const bothModes = (edits: ReadonlyArray<Edit>, fixture: Fixture = SINGLE_PROJECT) =>
  Effect.all({ rule: runOf(fixture, edits, 'location-rule'), always: runOf(fixture, edits, 'always') })

const REFERENCED_EDIT: Edit = { id: AE10, file: 'lib/src/counter.ts', target: 'x + 1', replacement: 'x.missing' }

Feature('Skipping importer re-checks for edits inside a function body', { timeout: 240_000 })
  .withLayer(FILE_PORTS)
  .live('real tsgo checks fixture files on disk with the importer shortcut on and off')
  .body(({ scenario }) => {
    scenario(
      'Every Soundness Rule case gets the same verdicts with the shortcut on and off',
      Gherkin.Do.pipe(
        When('one mutant per rule case is checked once per importerCheck value')('seen', () => bothModes(RULE_EDITS)),
        Then(
          'only the annotated body edit takes the shortcut, each other case names its failing clause, and the verdicts agree',
        )((s, expect) =>
          expect({
            rule: s.seen.rule.statuses,
            always: s.seen.always.statuses,
            blamed: s.seen.rule.blamed,
            blamedAlways: s.seen.always.blamed,
            ruleCounts: s.seen.rule.shortcutCounts,
            alwaysCounts: s.seen.always.shortcutCounts,
          }).toEqual({
            rule: {
              [AE1]: 'passed',
              [AE2]: 'compileError',
              [AE3]: 'compileError',
              [AE4]: 'compileError',
              [AE7]: 'passed',
              [AE8]: 'compileError',
              [AE9]: 'compileError',
            },
            always: s.seen.rule.statuses,
            blamed: {
              [AE1]: [],
              [AE2]: ['consumer.ts'],
              [AE3]: ['consumer.ts'],
              [AE4]: ['loader.ts'],
              [AE7]: [],
              [AE8]: ['contextual.ts'],
              [AE9]: ['consumer.ts'],
            },
            blamedAlways: s.seen.rule.blamed,
            ruleCounts: {
              'count': 1,
              'fallback.original.body-dependent-signature.count': 3,
              'fallback.original.outside-function-body.count': 1,
              'fallback.original.module-reference.count': 1,
              'fallback.mutated.body-dependent-signature.count': 1,
            },
            alwaysCounts: { count: 0 },
          })
        ),
      ),
    )

    scenario(
      'Shortcut mutants in two files share one snapshot update',
      Gherkin.Do.pipe(
        When('a body edit in each of two annotated functions is checked once per importerCheck value')(
          'seen',
          () => bothModes([AE1_EDIT, AE5_EDIT]),
        ),
        Then('the shortcut run updates the snapshot once for both, the always run once per mutant')((s, expect) =>
          expect({
            statuses: [s.seen.rule.statuses, s.seen.always.statuses],
            counts: [s.seen.rule.shortcutCounts, s.seen.always.shortcutCounts],
            updates: [s.seen.rule.snapshotUpdates, s.seen.always.snapshotUpdates],
          }).toEqual({
            statuses: [{ [AE1]: 'passed', [AE5]: 'passed' }, { [AE1]: 'passed', [AE5]: 'passed' }],
            counts: [{ count: 2 }, { count: 0 }],
            updates: [2, 3],
          })
        ),
      ),
    )

    scenario(
      'A body edit in a referenced project is checked by the project that owns the file',
      Gherkin.Do.pipe(
        When(
          'a compile-breaking body edit in a project another project references is checked once per importerCheck value',
        )(
          'seen',
          () => bothModes([REFERENCED_EDIT], REFERENCED_PROJECT),
        ),
        Then('both runs reject it, blame the edited file, and the rule run takes the shortcut')((s, expect) =>
          expect({
            statuses: [s.seen.rule.statuses, s.seen.always.statuses],
            blamed: [s.seen.rule.blamed, s.seen.always.blamed],
            counts: [s.seen.rule.shortcutCounts, s.seen.always.shortcutCounts],
          }).toEqual({
            statuses: [{ [AE10]: 'compileError' }, { [AE10]: 'compileError' }],
            blamed: [{ [AE10]: ['lib/src/counter.ts'] }, { [AE10]: ['lib/src/counter.ts'] }],
            counts: [{ count: 1 }, { count: 0 }],
          })
        ),
      ),
    )

    scenario(
      'The importerCheck option refuses a value it does not know and turns the shortcut off only on always',
      Gherkin.Do.pipe(
        When('the annotated body edit is checked under each importerCheck value, valid and invalid')(
          'seen',
          () =>
            Effect.all({
              sometimes: optionOutcomeOf({ typescriptChecker: { importerCheck: 'sometimes' } }),
              number: optionOutcomeOf({ typescriptChecker: { importerCheck: 1 } }),
              always: optionOutcomeOf({ typescriptChecker: { importerCheck: 'always' } }),
              locationRule: optionOutcomeOf({ typescriptChecker: { importerCheck: 'location-rule' } }),
              omitted: optionOutcomeOf({}),
            }),
        ),
        Then(
          'an unknown value fails the check as invalid checker options, always re-checks importers, and the rule is the default',
        )((s, expect) =>
          expect(s.seen).toEqual({
            sometimes: { refused: { mutantIds: [AE1], invalidOptions: true } },
            number: { refused: { mutantIds: [AE1], invalidOptions: true } },
            always: { status: 'passed', shortcuts: 0 },
            locationRule: { status: 'passed', shortcuts: 1 },
            omitted: { status: 'passed', shortcuts: 1 },
          })
        ),
      ),
    )
  })
