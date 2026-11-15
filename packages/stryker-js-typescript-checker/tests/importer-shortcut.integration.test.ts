import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Checker, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { CheckerRuntime, TypeScriptCheckerRuntime } from '@systemfsoftware/stryker-js-typescript-checker/runtime'
import { Contract, ObservationWindow, Stimulus } from '@systemfsoftware/trace-spec'
import { Span } from '@systemfsoftware/trace-taxonomy'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'

import {
  CheckerRuns,
  CheckRun,
  recordsShortcuts,
  type ShortcutRecord,
} from './__fixtures__/importer-shortcut-trace.fixture.js'

const Feature = makeFeature({ it })

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const FILE_PORTS = Layer.mergeAll(
  FILE_AND_PATH,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)),
  ObservationWindow.make('importer-shortcut-test').layer,
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
const GLOBAL_EDIT_ID = '00000000000000b1'
const REQUIRE_EDIT_ID = '00000000000000b2'
const IMPORT_TYPE_EDIT_ID = '00000000000000b3'
const SCRIPT_EDIT_ID = '00000000000000b4'
const TERMINATOR_EDIT_ID = '00000000000000b5'
const SYNTAX_EDIT_ID = '00000000000000b6'
const UNHELD_EDIT_ID = '00000000000000b7'
const CONSTRUCTOR_EDIT_ID = '00000000000000b8'
const EXCLUDED_EDIT_ID = '0000000000000b11'
const SECOND_CALL_EDIT_ID = '0000000000000b12'
const IMPLICIT_RETURN_EDIT_ID = '00000000000000b9'
const INDEXED_ACCESS_EDIT_ID = '0000000000000b10'
const SETTER_EDIT_ID = '0000000000000b13'

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
    'constructed.ts',
    'consumer.ts',
    'contextual.ts',
    'defaults.ts',
    'excluded.ts',
    'global.ts',
    'imported-type.ts',
    'inferred.ts',
    'loader.ts',
    'required.ts',
    'script.ts',
    'stored.ts',
  ],
}

const REFERENCED_PROJECT: Fixture = {
  directory: 'importer-shortcut-references',
  files: ['lib/src/counter.ts', 'app/src/consumer.ts'],
}

const OVERLAPPING_PROJECTS: Fixture = {
  directory: 'importer-shortcut-overlap',
  files: ['shared/total.ts'],
}

const OVERLAP_EDITS: ReadonlyArray<Edit> = [
  {
    id: IMPLICIT_RETURN_EDIT_ID,
    file: 'shared/total.ts',
    target: '1',
    replacement: 'Number(((x: number) => { if (x) return 1 })(n))',
  },
  {
    id: INDEXED_ACCESS_EDIT_ID,
    file: 'shared/total.ts',
    target: 'n + 1',
    replacement: 'n + [1][0]',
  },
]

const AE1_EDIT: Edit = { id: AE1, file: 'annotated.ts', target: 'x + 1', replacement: 'x - 1' }
const AE5_EDIT: Edit = { id: AE5, file: 'closer.ts', target: 'return x', replacement: 'return -x' }
const AE7_EDIT: Edit = {
  id: AE7,
  file: 'closer.ts',
  target: 'return x',
  replacement: 'return x\n}\nexport function closed(): string {\n  return ""',
}

interface GuardRow {
  readonly edit: Edit
  readonly fallback: string
}

const GUARD_ROWS: Readonly<Record<string, GuardRow>> = {
  declareGlobal: {
    edit: { id: GLOBAL_EDIT_ID, file: 'global.ts', target: 'x + 2', replacement: 'x - 2' },
    fallback: 'original.not-typescript-module',
  },
  requireCall: {
    edit: { id: REQUIRE_EDIT_ID, file: 'required.ts', target: "'./annotated.js'", replacement: "''" },
    fallback: 'original.module-reference',
  },
  typeofImport: {
    edit: { id: IMPORT_TYPE_EDIT_ID, file: 'imported-type.ts', target: "'./box.js'", replacement: "''" },
    fallback: 'original.module-reference',
  },
  nonModuleFile: {
    edit: { id: SCRIPT_EDIT_ID, file: 'script.ts', target: 'x * 2', replacement: 'x / 2' },
    fallback: 'original.not-typescript-module',
  },
  removedTerminator: {
    edit: { id: TERMINATOR_EDIT_ID, file: 'closer.ts', target: 'x\n}', replacement: 'x' },
    fallback: 'original.outside-function-body',
  },
  syntaxError: {
    edit: { id: SYNTAX_EDIT_ID, file: 'annotated.ts', target: 'x + 1', replacement: 'x +' },
    fallback: 'mutated.syntax-error',
  },
}

const EXCLUDED_EDIT: Edit = { id: EXCLUDED_EDIT_ID, file: 'excluded.ts', target: 'x * 3', replacement: 'x / 3' }

const RETYPED_EDIT: Edit = {
  id: AE2,
  file: 'inferred.ts',
  target: 'return doubled',
  replacement: 'return String(doubled)',
}

const SECOND_CALL_EDIT: Edit = {
  id: SECOND_CALL_EDIT_ID,
  file: 'consumer.ts',
  target: 'increment(1)',
  replacement: 'increment(2)',
}

const UNHELD_EDIT: Edit = { id: UNHELD_EDIT_ID, file: 'annotated.ts', target: '1', replacement: '1 ? 2 : 3' }

const RULE_EDITS: ReadonlyArray<Edit> = [
  AE1_EDIT,
  RETYPED_EDIT,
  { id: AE3, file: 'defaults.ts', target: '1', replacement: '""' },
  { id: AE4, file: 'loader.ts', target: "'./annotated.js'", replacement: "''" },
  AE7_EDIT,
  { id: AE8, file: 'contextual.ts', target: 'x + 1', replacement: 'String(x)' },
  { id: AE9, file: 'box.ts', target: 'this.items.length', replacement: '""' },
  { id: CONSTRUCTOR_EDIT_ID, file: 'constructed.ts', target: '1', replacement: "'one'" },
  { id: SETTER_EDIT_ID, file: 'stored.ts', target: 'next + 1', replacement: 'next - 1' },
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

interface Checked {
  readonly results: HashMap.HashMap<string, Checker.CheckResult>
}

interface CheckerOptionsInput {
  readonly typescriptChecker?: Readonly<Record<string, string | number>>
}

const checkedWith = (
  fixture: Fixture,
  calls: ReadonlyArray<ReadonlyArray<Edit>>,
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
    const wiresPerCall = yield* Effect.forEach(
      calls,
      (edits) => S.decodeEffect(S.Array(Checker.CheckerMutantWire))(edits.map(wireOf(texts, join))),
    ).pipe(Effect.orDie)
    return yield* Effect.gen(function*() {
      const runtime = yield* CheckerRuntime
      const checker = yield* runtime.checker.pipe(Effect.orDie)
      const perCall = yield* Effect.forEach(wiresPerCall, (wires) => checker.check([...wires]))
      const results = Arr.reduce(
        perCall,
        HashMap.empty<string, Checker.CheckResult>(),
        (merged, call) => HashMap.union(merged, call),
      )
      return { results }
    }).pipe(Effect.provide(TypeScriptCheckerRuntime.layer(options)))
  })

const runOf = (
  fixture: Fixture,
  calls: ReadonlyArray<ReadonlyArray<Edit>>,
  importerCheck: ImporterCheck,
): Effect.Effect<Run, never, FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.map(checkedWith(fixture, calls, { typescriptChecker: { importerCheck } }), ({ results }) => {
    const edits = calls.flat()
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
    }
  }).pipe(Effect.orDie)

type OptionOutcome =
  | { readonly refused: { readonly mutantIds: ReadonlyArray<string>; readonly invalidOptions: boolean } }
  | { readonly status: string }

const refusedWith = (cause: string, tag: string, code: string, nextAction: string): boolean =>
  cause.startsWith(`${tag}: typescript checker (${code}): `) && cause.includes(`. ${nextAction}\n`)

const INVALID_OPTIONS_NEXT_ACTION =
  "Set typescriptChecker.importerCheck to 'location-rule' or 'always', or remove it, and remove every other key from the typescriptChecker block"
const DUPLICATE_IDS_NEXT_ACTION = 'Send each mutant id once per check call'

const duplicateOutcomeOf = (
  edits: ReadonlyArray<Edit>,
): Effect.Effect<
  { readonly mutantIds: ReadonlyArray<string>; readonly duplicateIds: boolean } | 'checked',
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  checkedWith(SINGLE_PROJECT, [edits], {}).pipe(
    Effect.match({
      onFailure: (failed) => ({
        mutantIds: [...failed.mutantIds],
        duplicateIds: refusedWith(
          failed.cause,
          'DuplicateMutantIds',
          'duplicate-mutant-ids',
          DUPLICATE_IDS_NEXT_ACTION,
        ),
      }),
      onSuccess: () => 'checked' as const,
    }),
  )

const optionOutcomeOf = (
  checkerOptions: CheckerOptionsInput,
): Effect.Effect<OptionOutcome, never, FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner> =>
  checkedWith(SINGLE_PROJECT, [[AE1_EDIT]], checkerOptions).pipe(
    Effect.match({
      onFailure: (failed): OptionOutcome => ({
        refused: {
          mutantIds: [...failed.mutantIds],
          invalidOptions: refusedWith(
            failed.cause,
            'InvalidCheckerOptions',
            'invalid-checker-options',
            INVALID_OPTIONS_NEXT_ACTION,
          ),
        },
      }),
      onSuccess: ({ results }): OptionOutcome => ({
        status: Option.match(HashMap.get(results, AE1), { onNone: () => 'missing', onSome: (r) => r.status }),
      }),
    }),
  )

type Services = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

interface RunRequest {
  readonly label: string
  readonly fixture: Fixture
  readonly calls: ReadonlyArray<ReadonlyArray<Edit>>
  readonly importerCheck: ImporterCheck
}

const labelled = <A, E, R>(label: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  effect.pipe(Span.start(CheckRun, { label }))

const checkRuns = Stimulus.make({
  name: 'typescript_checker.check_runs',
  run: (
    { input }: { readonly input: ReadonlyArray<RunRequest> },
  ): Effect.Effect<Readonly<Record<string, Run>>, never, Services> =>
    Effect.forEach(
      input,
      (request) =>
        labelled(request.label, runOf(request.fixture, request.calls, request.importerCheck)).pipe(
          Effect.map((run) => [request.label, run] as const),
        ),
    ).pipe(Effect.map((runs) => Object.fromEntries(runs))),
})

const checkOptionVariants = Stimulus.make({
  name: 'typescript_checker.check_option_variants',
  run: (
    { input }: { readonly input: Readonly<Record<string, CheckerOptionsInput>> },
  ): Effect.Effect<Readonly<Record<string, OptionOutcome>>, never, Services> =>
    Effect.forEach(
      Object.entries(input),
      ([label, checkerOptions]) =>
        labelled(label, optionOutcomeOf(checkerOptions)).pipe(Effect.map((outcome) => [label, outcome] as const)),
    ).pipe(Effect.map((outcomes) => Object.fromEntries(outcomes))),
})

type Expectations = Readonly<Record<string, ShortcutRecord>>

const judgedRuns = (requests: ReadonlyArray<RunRequest>, expected: Expectations) => {
  const contract = Contract.of(CheckerRuns).stimulate(checkRuns).holds(recordsShortcuts(expected))
  return Effect.map(Contract.judge(contract, requests), (judgment) => ({ contract, judgment }))
}

const judgedOptionVariants = (variants: Readonly<Record<string, CheckerOptionsInput>>, expected: Expectations) => {
  const contract = Contract.of(CheckerRuns).stimulate(checkOptionVariants).holds(recordsShortcuts(expected))
  return Effect.map(Contract.judge(contract, variants), (judgment) => ({ contract, judgment }))
}

const modeRequests = (
  calls: ReadonlyArray<ReadonlyArray<Edit>>,
  fixture: Fixture,
  prefix = '',
): ReadonlyArray<RunRequest> => [
  { label: `${prefix}rule`, fixture, calls, importerCheck: 'location-rule' },
  { label: `${prefix}always`, fixture, calls, importerCheck: 'always' },
]

/** What the compiler check of each importerCheck value is expected to record; a mode left out is not checked. */
interface ModeExpectations {
  readonly rule?: ShortcutRecord
  readonly always?: ShortcutRecord
}

const expectationsOf = (expected: ModeExpectations, prefix = ''): Expectations =>
  Object.fromEntries([
    ...(expected.rule === undefined ? [] : [[`${prefix}rule`, expected.rule] as const]),
    ...(expected.always === undefined ? [] : [[`${prefix}always`, expected.always] as const]),
  ])

const bothModesAcross = (
  calls: ReadonlyArray<ReadonlyArray<Edit>>,
  expected: ModeExpectations,
  fixture: Fixture = SINGLE_PROJECT,
) => judgedRuns(modeRequests(calls, fixture), expectationsOf(expected))

const bothModes = (edits: ReadonlyArray<Edit>, expected: ModeExpectations, fixture: Fixture = SINGLE_PROJECT) =>
  bothModesAcross([edits], expected, fixture)

const runLabelled = (output: Readonly<Record<string, Run>>, label: string): Run =>
  Option.getOrThrowWith(Option.fromNullishOr(output[label]), () => new Error(`no run was labelled ${label}`))

const bothModesOf = (output: Readonly<Record<string, Run>>, prefix = '') => ({
  rule: runLabelled(output, `${prefix}rule`),
  always: runLabelled(output, `${prefix}always`),
})

const unobservedBothModes = (calls: ReadonlyArray<ReadonlyArray<Edit>>) =>
  Effect.map(checkRuns(modeRequests(calls, SINGLE_PROJECT)), (observed) => bothModesOf(observed.output))

const SHORTCUT_COUNTS_RECORDED = 'each compiler check records the importer shortcut counts the run was expected to'

const REFERENCED_EDIT: Edit = { id: AE10, file: 'lib/src/counter.ts', target: 'x + 1', replacement: 'x.missing' }

Feature('Skipping importer re-checks for edits inside a function body', { timeout: 240_000 })
  .withLayer(FILE_PORTS)
  .live(
    'real tsgo checks fixture files on disk with the importer shortcut on and off, and the trace observation window reads spans back from an OpenTelemetry exporter that schedules its export on a real timer',
  )
  .body(({ scenario }) => {
    scenario(
      'Every Soundness Rule case gets the same verdicts with the shortcut on and off, a set accessor body takes it, and a constructor body never does',
      Gherkin.Do.pipe(
        When('one mutant per rule case is checked once per importerCheck value')('judged', () =>
          bothModes(RULE_EDITS, {
            rule: {
              counts: {
                'count': 2,
                'fallback.original.body-dependent-signature.count': 4,
                'fallback.original.outside-function-body.count': 1,
                'fallback.original.module-reference.count': 1,
                'fallback.mutated.syntax-error.count': 1,
              },
            },
            always: { counts: { count: 0 } },
          })),
        Then(SHORTCUT_COUNTS_RECORDED)((s, expect) =>
          Contract.verdictCheck(s.judged.contract, expect, s.judged.judgment)
        ),
        When('what the checker answered is read back')(
          'seen',
          (s) => Effect.succeed(bothModesOf(s.judged.judgment.run.output)),
        ),
        Then(
          'only the annotated function and set accessor body edits take the shortcut, each other case names its failing clause, and the verdicts agree',
        )((s, expect) =>
          expect({
            rule: s.seen.rule.statuses,
            always: s.seen.always.statuses,
            blamed: s.seen.rule.blamed,
            blamedAlways: s.seen.always.blamed,
          }).toEqual({
            rule: {
              [AE1]: 'passed',
              [AE2]: 'compileError',
              [AE3]: 'compileError',
              [AE4]: 'compileError',
              [AE7]: 'passed',
              [AE8]: 'compileError',
              [AE9]: 'compileError',
              [CONSTRUCTOR_EDIT_ID]: 'compileError',
              [SETTER_EDIT_ID]: 'passed',
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
              [CONSTRUCTOR_EDIT_ID]: ['consumer.ts'],
              [SETTER_EDIT_ID]: [],
            },
            blamedAlways: s.seen.rule.blamed,
          })
        ),
      ),
    )

    scenario(
      'Shortcut mutants in two files share one snapshot update',
      Gherkin.Do.pipe(
        When('a body edit in each of two annotated functions is checked once per importerCheck value')(
          'judged',
          () =>
            bothModes([AE1_EDIT, AE5_EDIT], {
              rule: { counts: { count: 2 }, snapshotUpdates: 2 },
              always: { counts: { count: 0 }, snapshotUpdates: 3 },
            }),
        ),
        Then('the shortcut run updates the snapshot once for both, the always run once per mutant')((s, expect) =>
          Contract.verdictCheck(s.judged.contract, expect, s.judged.judgment)
        ),
        When('what the checker answered is read back')(
          'seen',
          (s) => Effect.succeed(bothModesOf(s.judged.judgment.run.output)),
        ),
        Then('both runs pass both edits')((s, expect) =>
          expect([s.seen.rule.statuses, s.seen.always.statuses]).toEqual([
            { [AE1]: 'passed', [AE5]: 'passed' },
            { [AE1]: 'passed', [AE5]: 'passed' },
          ])
        ),
      ),
    )

    scenario(
      'A body edit in a referenced project is checked by the project that owns the file',
      Gherkin.Do.pipe(
        When(
          'a compile-breaking body edit in a project another project references is checked once per importerCheck value',
        )(
          'judged',
          () =>
            bothModes(
              [REFERENCED_EDIT],
              { rule: { counts: { count: 1 } }, always: { counts: { count: 0 } } },
              REFERENCED_PROJECT,
            ),
        ),
        Then('the rule run takes the shortcut and the always run does not')((s, expect) =>
          Contract.verdictCheck(s.judged.contract, expect, s.judged.judgment)
        ),
        When('what the checker answered is read back')(
          'seen',
          (s) => Effect.succeed(bothModesOf(s.judged.judgment.run.output)),
        ),
        Then('both runs reject it and blame the edited file')((s, expect) =>
          expect({
            statuses: [s.seen.rule.statuses, s.seen.always.statuses],
            blamed: [s.seen.rule.blamed, s.seen.always.blamed],
          }).toEqual({
            statuses: [{ [AE10]: 'compileError' }, { [AE10]: 'compileError' }],
            blamed: [{ [AE10]: ['lib/src/counter.ts'] }, { [AE10]: ['lib/src/counter.ts'] }],
          })
        ),
      ),
    )

    scenario(
      'A body edit in a file two unrelated projects compile is checked by both of them',
      Gherkin.Do.pipe(
        When(
          'one body edit that only the noImplicitReturns project rejects and one that only the noUncheckedIndexedAccess project rejects are checked once per importerCheck value',
        )('judged', () =>
          bothModes(OVERLAP_EDITS, {
            rule: { counts: { 'count': 0, 'fallback.original.shared-file.count': 2 } },
            always: { counts: { count: 0 } },
          }, OVERLAPPING_PROJECTS)),
        Then('the rule run counts each edit under the shared-file fallback')((s, expect) =>
          Contract.verdictCheck(s.judged.contract, expect, s.judged.judgment)
        ),
        When('what the checker answered is read back')(
          'seen',
          (s) => Effect.succeed(bothModesOf(s.judged.judgment.run.output)),
        ),
        Then('both runs reject both edits')((s, expect) =>
          expect({
            statuses: [s.seen.rule.statuses, s.seen.always.statuses],
            blamed: [s.seen.rule.blamed, s.seen.always.blamed],
          }).toEqual({
            statuses: [
              { [IMPLICIT_RETURN_EDIT_ID]: 'compileError', [INDEXED_ACCESS_EDIT_ID]: 'compileError' },
              { [IMPLICIT_RETURN_EDIT_ID]: 'compileError', [INDEXED_ACCESS_EDIT_ID]: 'compileError' },
            ],
            blamed: [
              { [IMPLICIT_RETURN_EDIT_ID]: ['shared/total.ts'], [INDEXED_ACCESS_EDIT_ID]: ['shared/total.ts'] },
              { [IMPLICIT_RETURN_EDIT_ID]: ['shared/total.ts'], [INDEXED_ACCESS_EDIT_ID]: ['shared/total.ts'] },
            ],
          })
        ),
      ),
    )

    scenario(
      'A body edit in a file no project includes is counted as unread and checked by no project',
      Gherkin.Do.pipe(
        When('a body edit in a file the tsconfig excludes is checked once per importerCheck value')(
          'judged',
          () =>
            bothModes([EXCLUDED_EDIT], {
              rule: { counts: { 'count': 0, 'fallback.unread.count': 1 } },
              always: { counts: { count: 0 } },
            }),
        ),
        Then('only the rule run counts it as unread')((s, expect) =>
          Contract.verdictCheck(s.judged.contract, expect, s.judged.judgment)
        ),
        When('what the checker answered is read back')(
          'seen',
          (s) => Effect.succeed(bothModesOf(s.judged.judgment.run.output)),
        ),
        Then('both runs pass it with nothing blamed')((s, expect) =>
          expect({
            statuses: [s.seen.rule.statuses, s.seen.always.statuses],
            blamed: [s.seen.rule.blamed, s.seen.always.blamed],
          }).toEqual({
            statuses: [{ [EXCLUDED_EDIT_ID]: 'passed' }, { [EXCLUDED_EDIT_ID]: 'passed' }],
            blamed: [{ [EXCLUDED_EDIT_ID]: [] }, { [EXCLUDED_EDIT_ID]: [] }],
          })
        ),
      ),
    )

    scenario(
      'A check call starts from the original files, not from the last mutant of the call before it',
      Gherkin.Do.pipe(
        When(
          'one call checks an edit that changes a type the consumer reads, and the next call checks an edit in that consumer',
        )('seen', () => unobservedBothModes([[RETYPED_EDIT], [SECOND_CALL_EDIT]])),
        Then('the first edit is rejected in the consumer, and the consumer edit in the next call passes')((s, expect) =>
          expect({
            statuses: [s.seen.rule.statuses, s.seen.always.statuses],
            blamed: [s.seen.rule.blamed, s.seen.always.blamed],
          }).toEqual({
            statuses: [
              { [AE2]: 'compileError', [SECOND_CALL_EDIT_ID]: 'passed' },
              { [AE2]: 'compileError', [SECOND_CALL_EDIT_ID]: 'passed' },
            ],
            blamed: [{ [AE2]: ['consumer.ts'], [SECOND_CALL_EDIT_ID]: [] }, {
              [AE2]: ['consumer.ts'],
              [SECOND_CALL_EDIT_ID]: [],
            }],
          })
        ),
      ),
    )

    scenario(
      'The importerCheck option refuses a value or key it does not know and turns the shortcut off only on always',
      Gherkin.Do.pipe(
        When(
          'the annotated body edit is checked under each importerCheck value, valid and invalid, and with unknown keys',
        )(
          'judged',
          () =>
            judgedOptionVariants({
              sometimes: { typescriptChecker: { importerCheck: 'sometimes' } },
              number: { typescriptChecker: { importerCheck: 1 } },
              misspelled: { typescriptChecker: { importercheck: 'always' } },
              extraKey: { typescriptChecker: { importerCheck: 'always', strict: 'yes' } },
              always: { typescriptChecker: { importerCheck: 'always' } },
              locationRule: { typescriptChecker: { importerCheck: 'location-rule' } },
              omitted: {},
            }, {
              always: { counts: { count: 0 } },
              locationRule: { counts: { count: 1 } },
              omitted: { counts: { count: 1 } },
            }),
        ),
        Then('always re-checks importers, and the rule is the default')((s, expect) =>
          Contract.verdictCheck(s.judged.contract, expect, s.judged.judgment)
        ),
        When('what the checker answered is read back')('seen', (s) => Effect.succeed(s.judged.judgment.run.output)),
        Then('an unknown value or key fails the check as invalid checker options')((s, expect) =>
          expect(s.seen).toEqual({
            sometimes: { refused: { mutantIds: [AE1], invalidOptions: true } },
            number: { refused: { mutantIds: [AE1], invalidOptions: true } },
            misspelled: { refused: { mutantIds: [AE1], invalidOptions: true } },
            extraKey: { refused: { mutantIds: [AE1], invalidOptions: true } },
            always: { status: 'passed' },
            locationRule: { status: 'passed' },
            omitted: { status: 'passed' },
          })
        ),
      ),
    )

    scenario(
      'A check call that names one mutant twice is refused with the duplicate reason',
      Gherkin.Do.pipe(
        When('the same annotated body edit is sent twice in one call, and once')('seen', () =>
          Effect.all({
            twice: duplicateOutcomeOf([AE1_EDIT, AE1_EDIT]),
            once: duplicateOutcomeOf([AE1_EDIT]),
          })),
        Then('the doubled call fails naming the duplicate reason and the single call is checked')((s, expect) =>
          expect(s.seen).toEqual({
            twice: { mutantIds: [AE1, AE1], duplicateIds: true },
            once: 'checked',
          })
        ),
      ),
    )

    scenario(
      'Each Soundness Rule guard sends its edit to the full importer check',
      Gherkin.Do.pipe(
        When('the edit behind each guard is checked alone once per importerCheck value')(
          'judged',
          () =>
            judgedRuns(
              Object.entries(GUARD_ROWS).flatMap(([row, guard]) =>
                modeRequests([[guard.edit]], SINGLE_PROJECT, `${row}.`)
              ),
              Object.fromEntries(
                Object.entries(GUARD_ROWS).map((
                  [row, guard],
                ) => [`${row}.rule`, { counts: { count: 0, [`fallback.${guard.fallback}.count`]: 1 } }]),
              ),
            ),
        ),
        Then('the rule run takes no shortcut and names the guard it fell back on')((s, expect) =>
          Contract.verdictCheck(s.judged.contract, expect, s.judged.judgment)
        ),
        When('what the checker answered is read back')('seen', (s) =>
          Effect.succeed(
            Object.entries(GUARD_ROWS).map(([row, guard]) => {
              const seen = bothModesOf(s.judged.judgment.run.output, `${row}.`)
              return {
                row,
                statuses: [
                  seen.rule.statuses[guard.edit.id] ?? 'missing',
                  seen.always.statuses[guard.edit.id] ?? 'missing',
                ],
              }
            }),
          )),
        Then('both runs agree')((s, expect) =>
          expect(s.seen).toEqual(
            Object.keys(GUARD_ROWS).map((row, index) => {
              const ruleStatus = s.seen[index]?.statuses[0] ?? 'missing'
              return { row, statuses: [ruleStatus, ruleStatus] }
            }),
          )
        ),
      ),
    )

    scenario(
      'A shared round whose member loses the shortcut after the edit is checked again one mutant at a time',
      Gherkin.Do.pipe(
        When('an annotated body edit and a body edit that closes its function early are checked together')(
          'judged',
          () =>
            bothModes([AE1_EDIT, AE7_EDIT], {
              rule: { counts: { 'count': 1, 'fallback.mutated.syntax-error.count': 1 }, snapshotUpdates: 6 },
              always: { snapshotUpdates: 4 },
            }),
        ),
        Then('only the first edit takes the shortcut, and the round is redone solo')((s, expect) =>
          Contract.verdictCheck(s.judged.contract, expect, s.judged.judgment)
        ),
        When('what the checker answered is read back')(
          'seen',
          (s) => Effect.succeed(bothModesOf(s.judged.judgment.run.output)),
        ),
        Then('the verdicts agree')((s, expect) =>
          expect([s.seen.rule.statuses, s.seen.always.statuses]).toEqual([
            { [AE1]: 'passed', [AE7]: 'passed' },
            { [AE1]: 'passed', [AE7]: 'passed' },
          ])
        ),
      ),
    )

    scenario(
      'A shared round member whose edit does not parse in place is parenthesized before the round is checked',
      Gherkin.Do.pipe(
        When('an edit that binds into its surroundings and another annotated body edit are checked together')(
          'judged',
          () =>
            bothModes([UNHELD_EDIT, AE5_EDIT], {
              rule: { counts: { count: 2 }, resplices: 1, snapshotUpdates: 3 },
            }),
        ),
        Then('both take the shortcut, and the unheld edit is parenthesized once inside the round')((s, expect) =>
          Contract.verdictCheck(s.judged.contract, expect, s.judged.judgment)
        ),
        When('what the checker answered is read back')(
          'seen',
          (s) => Effect.succeed(bothModesOf(s.judged.judgment.run.output)),
        ),
        Then('the verdicts agree')((s, expect) =>
          expect([s.seen.rule.statuses, s.seen.always.statuses]).toEqual([
            { [UNHELD_EDIT_ID]: 'passed', [AE5]: 'passed' },
            { [UNHELD_EDIT_ID]: 'passed', [AE5]: 'passed' },
          ])
        ),
      ),
    )
  })
