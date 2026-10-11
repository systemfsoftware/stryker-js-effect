import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
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

const OBJECT_BROKEN_ID = '0000000000000001'
const OBJECT_SIBLING_ID = '0000000000000002'
const CLASS_BROKEN_ID = '0000000000000003'

interface Observation {
  readonly batches: ReadonlyArray<ReadonlyArray<string>>
  readonly statuses: Readonly<Record<string, string>>
  readonly ignoreReasons: Readonly<Record<string, string>>
  readonly brokenBlamesTheImporter: boolean
  readonly brokenReason: string
  readonly brokenLine: string
}

type WireInput = S.Codec.Encoded<typeof Checker.CheckerMutantWire>

interface Case {
  readonly fixture: string
  readonly brokenId: string
  readonly observedIds: ReadonlyArray<string>
  readonly importerFile: string
  readonly mutatedFile: string
  readonly wires: (join: (name: string) => string) => ReadonlyArray<WireInput>
}

const statusOf = (results: HashMap.HashMap<string, Checker.CheckResult>, id: string): string =>
  Option.match(HashMap.get(results, id), { onNone: () => 'missing', onSome: (result) => result.status })

const ignoreReasonOf = (results: HashMap.HashMap<string, Checker.CheckResult>, id: string): string =>
  Option.match(HashMap.get(results, id), {
    onNone: () => '',
    onSome: (result) => (result.status === 'ignored' ? String(result.reason) : ''),
  })

const brokenReasonOf = (
  testCase: Case,
  results: HashMap.HashMap<string, Checker.CheckResult>,
): string =>
  Option.match(HashMap.get(results, testCase.brokenId), {
    onNone: () => '',
    onSome: (result) => (result.status === 'compileError' ? result.reason : ''),
  })

const reportingLineOf = (reason: string): string => {
  const positioned = /\((\d+),\d+\): /u.exec(reason)
  return positioned === null ? '' : positioned[1] ?? ''
}

const observedOf = (
  testCase: Case,
  batches: ReadonlyArray<ReadonlyArray<string>>,
  results: HashMap.HashMap<string, Checker.CheckResult>,
): Observation => {
  const brokenReason = brokenReasonOf(testCase, results)
  return {
    batches,
    statuses: Object.fromEntries(testCase.observedIds.map((id) => [id, statusOf(results, id)])),
    ignoreReasons: Object.fromEntries(testCase.observedIds.map((id) => [id, ignoreReasonOf(results, id)])),
    brokenBlamesTheImporter: brokenReason.includes(testCase.importerFile) &&
      !brokenReason.includes(testCase.mutatedFile),
    brokenReason,
    brokenLine: reportingLineOf(brokenReason),
  }
}

const checkIn = (
  directory: string,
  testCase: Case,
): Effect.Effect<
  Observation,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({
      tsconfigFile: pathService.join(directory, 'tsconfig.json'),
    })
    const wires = yield* S.decodeEffect(S.Array(Checker.CheckerMutantWire))(
      testCase.wires((name) => pathService.join(directory, name)),
    )
    return yield* Effect.gen(function*() {
      const runtime = yield* CheckerRuntime
      const checker = yield* Effect.orDie(runtime.checker)
      const batches = yield* checker.group([...wires])
      const results = yield* checker.check([...wires])
      return observedOf(testCase, batches, results)
    }).pipe(Effect.provide(CheckerRuntime.layer(options)))
  }).pipe(Effect.orDie)

const checkFixture = (
  testCase: Case,
): Effect.Effect<
  Observation,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    const here = yield* Effect.orDie(pathService.fromFileUrl(new URL(import.meta.url)))
    return yield* checkIn(pathService.join(pathService.dirname(here), '__fixtures__', testCase.fixture), testCase)
  })

const objectCase: Case = {
  fixture: 'per-mutant-check',
  brokenId: OBJECT_BROKEN_ID,
  observedIds: [OBJECT_BROKEN_ID, OBJECT_SIBLING_ID],
  importerFile: 'consumer.ts',
  mutatedFile: 'dep.ts',
  wires: (join) => [
    {
      id: OBJECT_BROKEN_ID,
      fileName: join('dep.ts'),
      mutatorName: 'ObjectLiteral',
      replacement: '{}',
      location: { start: { line: 1, column: 22 }, end: { line: 1, column: 40 } },
    },
    {
      id: OBJECT_SIBLING_ID,
      fileName: join('dep.ts'),
      mutatorName: 'BooleanLiteral',
      replacement: 'false',
      location: { start: { line: 2, column: 21 }, end: { line: 2, column: 25 } },
    },
  ],
}

const classCase: Case = {
  fixture: 'per-mutant-check-class',
  brokenId: CLASS_BROKEN_ID,
  observedIds: [CLASS_BROKEN_ID],
  importerFile: 'reader.ts',
  mutatedFile: 'holder.ts',
  wires: (join) => [
    {
      id: CLASS_BROKEN_ID,
      fileName: join('holder.ts'),
      mutatorName: 'ObjectLiteral',
      replacement: '{}',
      location: { start: { line: 2, column: 22 }, end: { line: 2, column: 32 } },
    },
  ],
}

const RE_EXPORT_BROKEN_ID = '0000000000000004'
const CALLEE_ID = '0000000000000005'
const STATEMENT_ID = '0000000000000006'

const reExportCase: Case = {
  fixture: 'per-mutant-check-reexport',
  brokenId: RE_EXPORT_BROKEN_ID,
  observedIds: [RE_EXPORT_BROKEN_ID],
  importerFile: 'consumer.ts',
  mutatedFile: 'payload.ts',
  wires: (join) => [
    {
      id: RE_EXPORT_BROKEN_ID,
      fileName: join('payload.ts'),
      mutatorName: 'ObjectLiteral',
      replacement: '{}',
      location: { start: { line: 2, column: 22 }, end: { line: 2, column: 32 } },
    },
  ],
}

const calleeCase: Case = {
  fixture: 'per-mutant-callee',
  brokenId: CALLEE_ID,
  observedIds: [CALLEE_ID],
  importerFile: 'dep.ts',
  mutatedFile: 'dep.ts',
  wires: (join) => [
    {
      id: CALLEE_ID,
      fileName: join('dep.ts'),
      mutatorName: 'X',
      replacement: 'self => self',
      location: { start: { line: 2, column: 40 }, end: { line: 2, column: 50 } },
    },
  ],
}

const statementCase: Case = {
  fixture: 'per-mutant-statement',
  brokenId: STATEMENT_ID,
  observedIds: [STATEMENT_ID],
  importerFile: 'dep.ts',
  mutatedFile: 'dep.ts',
  wires: (join) => [
    {
      id: STATEMENT_ID,
      fileName: join('dep.ts'),
      mutatorName: 'BlockStatement',
      replacement: '{}',
      location: { start: { line: 3, column: 33 }, end: { line: 5, column: 2 } },
    },
  ],
}

const POSITION_BROKEN_ID = '0000000000000011'
const POSITION_SHIFT_ID = '0000000000000012'

const positionCase: Case = {
  fixture: 'per-mutant-position',
  brokenId: POSITION_BROKEN_ID,
  observedIds: [POSITION_BROKEN_ID, POSITION_SHIFT_ID],
  importerFile: 'dep.ts',
  mutatedFile: 'dep.ts',
  wires: (join) => [
    {
      id: POSITION_BROKEN_ID,
      fileName: join('dep.ts'),
      mutatorName: 'StringLiteral',
      replacement: '"nope"',
      location: { start: { line: 20, column: 31 }, end: { line: 20, column: 32 } },
    },
    {
      id: POSITION_SHIFT_ID,
      fileName: join('dep.ts'),
      mutatorName: 'BlockStatement',
      replacement: '{}',
      location: { start: { line: 1, column: 38 }, end: { line: 6, column: 2 } },
    },
  ],
}

const IMPORT_ID = '0000000000000007'

const importCase: Case = {
  fixture: 'per-mutant-import',
  brokenId: IMPORT_ID,
  observedIds: [IMPORT_ID],
  importerFile: 'dep.ts',
  mutatedFile: 'dep.ts',
  wires: (join) => [
    {
      id: IMPORT_ID,
      fileName: join('dep.ts'),
      mutatorName: 'StringLiteral',
      replacement: "''",
      location: { start: { line: 1, column: 51 }, end: { line: 1, column: 63 } },
    },
  ],
}

const TCE_EQUIVALENT_ID = '0000000000000008'
const TCE_KEPT_ID = '0000000000000009'
const TCE_DUPLICATE_ID = '0000000000000010'

const TCE_SITE = { start: { line: 1, column: 47 }, end: { line: 1, column: 52 } } as const

const tceCase: Case = {
  fixture: 'per-mutant-tce',
  brokenId: TCE_EQUIVALENT_ID,
  observedIds: [TCE_EQUIVALENT_ID, TCE_KEPT_ID, TCE_DUPLICATE_ID],
  importerFile: 'dep.ts',
  mutatedFile: 'dep.ts',
  wires: (join) => [
    {
      id: TCE_EQUIVALENT_ID,
      fileName: join('dep.ts'),
      mutatorName: 'ArithmeticOperator',
      replacement: 'a * 1',
      location: TCE_SITE,
    },
    {
      id: TCE_KEPT_ID,
      fileName: join('dep.ts'),
      mutatorName: 'ArithmeticOperator',
      replacement: 'a / 1',
      location: TCE_SITE,
    },
    {
      id: TCE_DUPLICATE_ID,
      fileName: join('dep.ts'),
      mutatorName: 'ArithmeticOperator',
      replacement: 'a/1',
      location: TCE_SITE,
    },
  ],
}

const TCE_PATHS_SITE = { start: { line: 2, column: 47 }, end: { line: 2, column: 52 } } as const

const tcePathsCase: Case = {
  ...tceCase,
  wires: (join) => tceCase.wires(join).map((wire) => ({ ...wire, location: TCE_PATHS_SITE })),
}

interface SizeMutant {
  readonly id: string
  readonly line: number
  readonly from: number
  readonly to: number
  readonly mutatorName: string
  readonly replacement: string
}

const sizeMutant = (
  id: string,
  [line, from, to]: readonly [number, number, number],
  mutatorName: string,
  replacement: string,
): SizeMutant => ({ id, line, from, to, mutatorName, replacement })

const STRING_ARRAY_SITE = [1, 52, 65] as const
const STRUCTURAL_SITE = [2, 60, 74] as const
const ANY_SITE = [3, 44, 57] as const
const AGAINST_ONE_SITE = [4, 54, 67] as const
const NO_TRUE_SIBLING_SITE = [5, 50, 63] as const
const NOT_CONSTANT_SITE = [6, 50, 63] as const
const COLLECTION_UNION_SITE = [7, 63, 76] as const
const MIXED_UNION_SITE = [8, 74, 87] as const

const SIZE_MUTANTS: ReadonlyArray<SizeMutant> = [
  sizeMutant('0000000000000020', STRING_ARRAY_SITE, 'EqualityOperator', 'xs.length >= 0'),
  sizeMutant('0000000000000021', STRING_ARRAY_SITE, 'ConditionalExpression', 'true'),
  sizeMutant('0000000000000022', STRING_ARRAY_SITE, 'EqualityOperator', 'xs.length < 0'),
  sizeMutant('0000000000000023', STRING_ARRAY_SITE, 'ConditionalExpression', 'false'),
  sizeMutant('0000000000000024', STRUCTURAL_SITE, 'EqualityOperator', 'box.length >= 0'),
  sizeMutant('0000000000000025', STRUCTURAL_SITE, 'ConditionalExpression', 'true'),
  sizeMutant('0000000000000026', ANY_SITE, 'EqualityOperator', 'xs.length >= 0'),
  sizeMutant('0000000000000027', ANY_SITE, 'ConditionalExpression', 'true'),
  sizeMutant('0000000000000028', AGAINST_ONE_SITE, 'EqualityOperator', 'xs.length >= 1'),
  sizeMutant('0000000000000029', AGAINST_ONE_SITE, 'ConditionalExpression', 'true'),
  sizeMutant('0000000000000030', NO_TRUE_SIBLING_SITE, 'EqualityOperator', 'xs.length >= 0'),
  sizeMutant('0000000000000031', NO_TRUE_SIBLING_SITE, 'ConditionalExpression', 'false'),
  sizeMutant('0000000000000032', NOT_CONSTANT_SITE, 'EqualityOperator', 'xs.length <= 0'),
  sizeMutant('0000000000000033', NOT_CONSTANT_SITE, 'ConditionalExpression', 'true'),
  sizeMutant('0000000000000034', COLLECTION_UNION_SITE, 'EqualityOperator', 'xs.length >= 0'),
  sizeMutant('0000000000000035', COLLECTION_UNION_SITE, 'ConditionalExpression', 'true'),
  sizeMutant('0000000000000036', MIXED_UNION_SITE, 'EqualityOperator', 'xs.length >= 0'),
  sizeMutant('0000000000000037', MIXED_UNION_SITE, 'ConditionalExpression', 'true'),
]

const collectionSizeCase: Case = {
  fixture: 'per-mutant-collection-size',
  brokenId: '',
  observedIds: SIZE_MUTANTS.map((mutant) => mutant.id),
  importerFile: 'size.ts',
  mutatedFile: 'size.ts',
  wires: (join) =>
    SIZE_MUTANTS.map((mutant) => ({
      id: mutant.id,
      fileName: join('size.ts'),
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      location: {
        start: { line: mutant.line, column: mutant.from },
        end: { line: mutant.line, column: mutant.to },
      },
    })),
}

const culledIdsOf = (reasons: Readonly<Record<string, string>>): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(reasons).filter(([, reason]) => reason !== ''))

const PATHS_PROJECT: Readonly<Record<string, string>> = {
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      strict: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      target: 'es2022',
      noEmit: true,
      skipLibCheck: true,
      types: [],
      paths: { '@lib/*': ['./lib/*.ts'] },
    },
    include: ['*.ts', 'lib/*.ts'],
  }),
  'dep.ts': "import { base } from '@lib/shared'\nexport const compute = (a: number): number => a * 1 + base\n",
  'lib/shared.ts': 'export const base = 2\n',
}

interface ProjectObservation extends Observation {
  readonly files: ReadonlyArray<string>
}

const checkPathsProject = (
  testCase: Case,
): Effect.Effect<
  ProjectObservation,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-tce-paths-' })
    yield* Effect.forEach(
      Object.entries(PATHS_PROJECT),
      ([name, text]) =>
        fs.makeDirectory(pathService.dirname(pathService.join(directory, name)), { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(pathService.join(directory, name), text)),
        ),
      { discard: true },
    )
    const observation = yield* checkIn(directory, testCase)
    const files = yield* fs.readDirectory(directory, { recursive: true })
    const regular = yield* Effect.filter(
      files,
      (name) => fs.stat(pathService.join(directory, name)).pipe(Effect.map((info) => info.type === 'File')),
    )
    return { ...observation, files: [...regular].sort() }
  })).pipe(Effect.orDie)

Feature('Deciding every TypeScript mutant on its own', { timeout: 120_000 })
  .withLayer(FILE_PORTS)
  .live('one warm TypeScript 7 program and the real filesystem settle batches in process')
  .body(({ scenario }) => {
    scenario(
      'A mutant that empties an exported object compiles in its own file but breaks its importer',
      Gherkin.Do.pipe(
        When('a batch holding that mutant and a passing sibling is handed to the checker runtime')(
          'seen',
          () => checkFixture(objectCase),
        ),
        Then(
          'the file forms one batch, the emptied object is a CompileError blaming the importer, and the sibling passes',
        )(
          (s, expect) =>
            expect({
              batches: s.seen.batches,
              statuses: s.seen.statuses,
              brokenBlamesTheImporter: s.seen.brokenBlamesTheImporter,
            }).toEqual({
              batches: [[OBJECT_BROKEN_ID, OBJECT_SIBLING_ID]],
              statuses: { [OBJECT_BROKEN_ID]: 'compileError', [OBJECT_SIBLING_ID]: 'passed' },
              brokenBlamesTheImporter: true,
            }),
        ),
      ),
    )

    scenario(
      'A mutant that empties a schema class field compiles in its own file but breaks its importer',
      Gherkin.Do.pipe(
        When('the mutant for the class field is handed to the checker runtime')('seen', () => checkFixture(classCase)),
        Then('the emptied field is a CompileError that blames the importer')((s, expect) =>
          expect({
            batches: s.seen.batches,
            statuses: s.seen.statuses,
            brokenBlamesTheImporter: s.seen.brokenBlamesTheImporter,
          }).toEqual({
            batches: [[CLASS_BROKEN_ID]],
            statuses: { [CLASS_BROKEN_ID]: 'compileError' },
            brokenBlamesTheImporter: true,
          })
        ),
      ),
    )

    scenario(
      'A mutant whose change reaches a consumer through a file that only re-exports it',
      Gherkin.Do.pipe(
        When('the mutant is handed to the checker runtime')('seen', () => checkFixture(reExportCase)),
        Then('the consumer past the re-export is blamed with a CompileError')((s, expect) =>
          expect({
            batches: s.seen.batches,
            statuses: s.seen.statuses,
            brokenBlamesTheImporter: s.seen.brokenBlamesTheImporter,
          }).toEqual({
            batches: [[RE_EXPORT_BROKEN_ID]],
            statuses: { [RE_EXPORT_BROKEN_ID]: 'compileError' },
            brokenBlamesTheImporter: true,
          })
        ),
      ),
    )

    scenario(
      'An arrow replacement in callee position is checked the way it runs',
      Gherkin.Do.pipe(
        When('the identity callee is replaced by an arrow')('seen', () => checkFixture(calleeCase)),
        Then('the mutant passes because the parenthesized call compiles')((s, expect) =>
          expect({ batches: s.seen.batches, statuses: s.seen.statuses }).toEqual({
            batches: [[CALLEE_ID]],
            statuses: { [CALLEE_ID]: 'passed' },
          })
        ),
      ),
    )

    scenario(
      'A block replacement keeps the statement it replaces',
      Gherkin.Do.pipe(
        When('a function body is replaced by an empty block')('seen', () => checkFixture(statementCase)),
        Then('the mutant passes because the block is spliced as a statement')((s, expect) =>
          expect({ batches: s.seen.batches, statuses: s.seen.statuses }).toEqual({
            batches: [[STATEMENT_ID]],
            statuses: { [STATEMENT_ID]: 'passed' },
          })
        ),
      ),
    )

    scenario(
      'An earlier mutant of one call reports the line its own text put it on',
      Gherkin.Do.pipe(
        When(
          'a mutant erroring on line 20 and a later mutant that empties the multi-line block above it are handed to the checker runtime in that order',
        )('seen', () => checkFixture(positionCase)),
        Then('the earlier mutant names line 20 and the later one passes')((s, expect) =>
          expect({
            batches: s.seen.batches,
            statuses: s.seen.statuses,
            brokenLine: s.seen.brokenLine,
          }).toEqual({
            batches: [[POSITION_BROKEN_ID, POSITION_SHIFT_ID]],
            statuses: { [POSITION_BROKEN_ID]: 'compileError', [POSITION_SHIFT_ID]: 'passed' },
            brokenLine: '20',
          })
        ),
      ),
    )

    scenario(
      'A mutant that empties a dynamic import specifier keeps the missing-module diagnostic',
      Gherkin.Do.pipe(
        When('the emptied specifier is handed to the checker runtime')('seen', () => checkFixture(importCase)),
        Then('the mutant is a CompileError that still names the module it cannot find')((s, expect) =>
          expect({
            batches: s.seen.batches,
            statuses: s.seen.statuses,
            missingModule: s.seen.brokenReason.includes('Cannot find module'),
          }).toEqual({
            batches: [[IMPORT_ID]],
            statuses: { [IMPORT_ID]: 'compileError' },
            missingModule: true,
          })
        ),
      ),
    )

    scenario(
      'A mutant that emits the same JavaScript as the original or a sibling is ignored',
      Gherkin.Do.pipe(
        When('three mutants of one site are handed to the checker runtime')('seen', () => checkFixture(tceCase)),
        Then('the original-equal and duplicate mutants are ignored while the changed one passes')((s, expect) =>
          expect({ batches: s.seen.batches, statuses: s.seen.statuses }).toEqual({
            batches: [[TCE_EQUIVALENT_ID, TCE_KEPT_ID, TCE_DUPLICATE_ID]],
            statuses: {
              [TCE_EQUIVALENT_ID]: 'ignored',
              [TCE_KEPT_ID]: 'passed',
              [TCE_DUPLICATE_ID]: 'ignored',
            },
          })
        ),
      ),
    )

    scenario(
      'Deciding equivalence never writes JavaScript into the project it checks',
      Gherkin.Do.pipe(
        When('the same three mutants sit in a file that imports a module through a tsconfig path alias')(
          'seen',
          () => checkPathsProject(tcePathsCase),
        ),
        Then('the mutants are decided as before and the project holds only the files it started with')((s, expect) =>
          expect({ statuses: s.seen.statuses, files: s.seen.files }).toEqual({
            statuses: {
              [TCE_EQUIVALENT_ID]: 'ignored',
              [TCE_KEPT_ID]: 'passed',
              [TCE_DUPLICATE_ID]: 'ignored',
            },
            files: ['dep.ts', 'lib/shared.ts', 'tsconfig.json'],
          })
        ),
      ),
    )

    scenario(
      'A size comparison the types make constant is ignored only when a kept sibling already is that constant',
      Gherkin.Do.pipe(
        When('comparisons of a length with zero, and their true and false siblings, are handed to the checker')(
          'seen',
          () => checkFixture(collectionSizeCase),
        ),
        Then(
          'only the array and all-collection-union comparisons are ignored, and every other mutant passes',
        )((s, expect) =>
          expect({
            passed: Object.values(s.seen.statuses).filter((status) => status === 'passed').length,
            culled: culledIdsOf(s.seen.ignoreReasons),
          }).toEqual({
            passed: SIZE_MUTANTS.length - 3,
            culled: {
              '0000000000000020': 'constant-collection-size: xs.length >= 0 is always true',
              '0000000000000022': 'constant-collection-size: xs.length < 0 is always false',
              '0000000000000034': 'constant-collection-size: xs.length >= 0 is always true',
            },
          })
        ),
      ),
    )
  })
