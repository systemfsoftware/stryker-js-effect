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
const ACCESSOR_SITE = [9, 73, 93] as const
const MIRRORED_SITE = [10, 55, 67] as const

const RECEIVER_SOURCE = [
  'export const chained = (box: { items: string[] }): boolean => box.items.length > 0',
  'export const fromCall = (read: () => string[]): boolean => read().length > 0',
  'export const fromIndex = (rows: [string[]]): boolean => rows[0].length > 0',
  'export const fromOptional = (xs: string[]): boolean => xs?.length > 0',
  'export const fromOptionalChain = (box: { items: string[] }): boolean => box?.items.length > 0',
  'export const fromAwait = async (load: Promise<string[]>): Promise<boolean> => (await load).length > 0',
  '',
].join('\n')

const PROPERTY_CHAIN_SITE = [1, 63, 83] as const
const CALL_SITE = [2, 60, 77] as const
const ELEMENT_ACCESS_SITE = [3, 57, 75] as const
const OPTIONAL_LENGTH_SITE = [4, 56, 70] as const
const OPTIONAL_CHAIN_SITE = [5, 73, 94] as const
const AWAIT_SITE = [6, 79, 102] as const

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

const RECEIVER_MUTANTS: ReadonlyArray<SizeMutant> = [
  sizeMutant('0000000000000040', PROPERTY_CHAIN_SITE, 'EqualityOperator', 'box.items.length >= 0'),
  sizeMutant('0000000000000041', PROPERTY_CHAIN_SITE, 'ConditionalExpression', 'true'),
  sizeMutant('0000000000000042', CALL_SITE, 'EqualityOperator', 'read().length >= 0'),
  sizeMutant('0000000000000043', CALL_SITE, 'ConditionalExpression', 'true'),
  sizeMutant('0000000000000044', ELEMENT_ACCESS_SITE, 'EqualityOperator', 'rows[0].length >= 0'),
  sizeMutant('0000000000000045', ELEMENT_ACCESS_SITE, 'ConditionalExpression', 'true'),
  sizeMutant('0000000000000046', OPTIONAL_LENGTH_SITE, 'EqualityOperator', 'xs?.length >= 0'),
  sizeMutant('0000000000000047', OPTIONAL_LENGTH_SITE, 'ConditionalExpression', 'true'),
  sizeMutant('0000000000000048', OPTIONAL_CHAIN_SITE, 'EqualityOperator', 'box?.items.length >= 0'),
  sizeMutant('0000000000000049', OPTIONAL_CHAIN_SITE, 'ConditionalExpression', 'true'),
  sizeMutant('0000000000000050', AWAIT_SITE, 'EqualityOperator', '(await load).length >= 0'),
  sizeMutant('0000000000000051', AWAIT_SITE, 'ConditionalExpression', 'true'),
]

const LOOSE_SIZE_MUTANTS: ReadonlyArray<SizeMutant> = [
  sizeMutant('0000000000000052', STRING_ARRAY_SITE, 'EqualityOperator', 'xs.length >= 0'),
  sizeMutant('0000000000000053', STRING_ARRAY_SITE, 'ConditionalExpression', 'true'),
]

const ACCESSOR_MUTANTS: ReadonlyArray<SizeMutant> = [
  sizeMutant('0000000000000060', ACCESSOR_SITE, 'EqualityOperator', 'box.items.length >= 0'),
  sizeMutant('0000000000000061', ACCESSOR_SITE, 'ConditionalExpression', 'true'),
]

const MIRRORED_MUTANTS: ReadonlyArray<SizeMutant> = [
  sizeMutant('0000000000000070', MIRRORED_SITE, 'EqualityOperator', '0 <= s.length'),
  sizeMutant('0000000000000071', MIRRORED_SITE, 'ConditionalExpression', 'true'),
  sizeMutant('0000000000000072', MIRRORED_SITE, 'EqualityOperator', '0 > s.length'),
  sizeMutant('0000000000000073', MIRRORED_SITE, 'ConditionalExpression', 'false'),
]

const sizeCaseOf = (fixture: string, mutants: ReadonlyArray<SizeMutant>): Case => ({
  fixture,
  brokenId: '',
  observedIds: mutants.map((mutant) => mutant.id),
  importerFile: 'size.ts',
  mutatedFile: 'size.ts',
  wires: (join) =>
    mutants.map((mutant) => ({
      id: mutant.id,
      fileName: join('size.ts'),
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      location: {
        start: { line: mutant.line, column: mutant.from },
        end: { line: mutant.line, column: mutant.to },
      },
    })),
})

const collectionSizeCase = sizeCaseOf('per-mutant-collection-size', SIZE_MUTANTS)

const receiverCase = sizeCaseOf('receiver-project', RECEIVER_MUTANTS)

const looseCollectionSizeCase = sizeCaseOf('loose-project', LOOSE_SIZE_MUTANTS)

const accessorReceiverCase = sizeCaseOf('per-mutant-collection-size', ACCESSOR_MUTANTS)

const mirroredReceiverCase = sizeCaseOf('per-mutant-collection-size', MIRRORED_MUTANTS)

const sizeProjectOf = (strictNullChecks: boolean, source: string): Readonly<Record<string, string>> => ({
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      strict: true,
      strictNullChecks,
      module: 'esnext',
      moduleResolution: 'bundler',
      target: 'es2022',
      noEmit: true,
      skipLibCheck: true,
      types: [],
    },
    include: ['*.ts'],
  }),
  'size.ts': source,
})

const culledReasonsOf = (reasons: Readonly<Record<string, string>>): Readonly<Record<string, string>> =>
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

const checkProject = (
  project: Readonly<Record<string, string>>,
  testCase: Case,
): Effect.Effect<
  ProjectObservation,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-checker-project-' })
    yield* Effect.forEach(
      Object.entries(project),
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
          () => checkProject(PATHS_PROJECT, tcePathsCase),
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
            culled: culledReasonsOf(s.seen.ignoreReasons),
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

    scenario(
      'A size comparison is ignored only when reading its receiver can neither run code nor fail',
      Gherkin.Do.pipe(
        When(
          'array length comparisons read through a property chain, a call, an element access, an optional chain and an await are handed to the checker',
        )(
          'seen',
          () => checkProject(sizeProjectOf(true, RECEIVER_SOURCE), receiverCase),
        ),
        Then('only the property-chain comparison is ignored, and every other mutant passes')((s, expect) =>
          expect({
            passed: Object.values(s.seen.statuses).filter((status) => status === 'passed').length,
            culled: culledReasonsOf(s.seen.ignoreReasons),
          }).toEqual({
            passed: RECEIVER_MUTANTS.length - 1,
            culled: {
              '0000000000000040': 'constant-collection-size: box.items.length >= 0 is always true',
            },
          })
        ),
      ),
    )

    scenario(
      'A size comparison is kept when reading its receiver runs an accessor',
      Gherkin.Do.pipe(
        When('an array length comparison read through a getter and its true sibling are handed to the checker')(
          'seen',
          () => checkFixture(accessorReceiverCase),
        ),
        Then('both mutants pass and neither is ignored')((s, expect) =>
          expect({ statuses: s.seen.statuses, culled: culledReasonsOf(s.seen.ignoreReasons) }).toEqual({
            statuses: {
              '0000000000000060': 'passed',
              '0000000000000061': 'passed',
            },
            culled: {},
          })
        ),
      ),
    )

    scenario(
      'A comparison that puts the length on the right is culled in its mirrored form',
      Gherkin.Do.pipe(
        When('the mirrored length-versus-zero comparisons and their true and false siblings are handed to the checker')(
          'seen',
          () => checkFixture(mirroredReceiverCase),
        ),
        Then('the always-true and always-false right-side comparisons are ignored and both siblings pass')((
          s,
          expect,
        ) =>
          expect({ statuses: s.seen.statuses, culled: culledReasonsOf(s.seen.ignoreReasons) }).toEqual({
            statuses: {
              '0000000000000070': 'ignored',
              '0000000000000071': 'passed',
              '0000000000000072': 'ignored',
              '0000000000000073': 'passed',
            },
            culled: {
              '0000000000000070': 'constant-collection-size: 0 <= s.length is always true',
              '0000000000000072': 'constant-collection-size: 0 > s.length is always false',
            },
          })
        ),
      ),
    )

    scenario(
      'A size comparison is counted when the program does not check null and undefined',
      Gherkin.Do.pipe(
        When('an array length comparison with zero and its true sibling come from a project with strictNullChecks off')(
          'seen',
          () =>
            checkProject(
              sizeProjectOf(false, 'export const nonEmpty = (xs: string[]): boolean => xs.length > 0\n'),
              looseCollectionSizeCase,
            ),
        ),
        Then('both mutants pass and neither is ignored')((s, expect) =>
          expect({ statuses: s.seen.statuses, culled: culledReasonsOf(s.seen.ignoreReasons) }).toEqual({
            statuses: { '0000000000000052': 'passed', '0000000000000053': 'passed' },
            culled: {},
          })
        ),
      ),
    )
  })
