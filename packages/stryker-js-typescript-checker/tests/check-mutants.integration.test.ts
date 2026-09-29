import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Checker, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { CheckerRuntime } from '@systemfsoftware/stryker-js-typescript-checker/runtime'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const FILE_PORTS = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const OBJECT_BROKEN_ID = '0000000000000001'
const OBJECT_SIBLING_ID = '0000000000000002'
const CLASS_BROKEN_ID = '0000000000000003'

interface Observation {
  readonly batches: ReadonlyArray<ReadonlyArray<string>>
  readonly statuses: Readonly<Record<string, string>>
  readonly brokenBlamesTheImporter: boolean
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

const observedOf = (
  testCase: Case,
  batches: ReadonlyArray<ReadonlyArray<string>>,
  results: HashMap.HashMap<string, Checker.CheckResult>,
): Observation => ({
  batches,
  statuses: Object.fromEntries(testCase.observedIds.map((id) => [id, statusOf(results, id)])),
  brokenBlamesTheImporter: Option.match(HashMap.get(results, testCase.brokenId), {
    onNone: () => false,
    onSome: (result) =>
      result.status === 'compileError' &&
      result.reason.includes(testCase.importerFile) &&
      !result.reason.includes(testCase.mutatedFile),
  }),
})

const checkFixture = (testCase: Case): Effect.Effect<Observation, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    const here = yield* Effect.orDie(pathService.fromFileUrl(new URL(import.meta.url)))
    const directory = pathService.join(pathService.dirname(here), '__fixtures__', testCase.fixture)
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
  })
