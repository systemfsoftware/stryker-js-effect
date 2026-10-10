import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import { Differential, Metamorphic } from '@systemfsoftware/differential-spec'
import { Checker, Options, TypeQuery } from '@systemfsoftware/stryker-js-plugin-interface'
import { CheckerRuntime } from '@systemfsoftware/stryker-js-typescript-checker/runtime'
import { TypeQueryLive } from '@systemfsoftware/stryker-js-typescript-checker/type-query'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as fc from 'fast-check'

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const FILE_PORTS = Layer.mergeAll(
  FILE_AND_PATH,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)),
)

const FIXTURE = decodeURIComponent(new URL('__fixtures__/type-query/', import.meta.url).pathname)
const SITES_FILE = `${FIXTURE}sites.ts`
const TSCONFIG_FILE = `${FIXTURE}tsconfig.json`

interface Site {
  readonly siteId: string
  readonly line: number
  readonly text: string
}

interface Row {
  readonly id: string
  readonly site: Site
  readonly candidate: string
}

const UNION: Site = { siteId: 'union', line: 1, text: `'a'` }
const TUPLE: Site = { siteId: 'tuple', line: 3, text: `['x']` }
const GENERIC: Site = { siteId: 'generic', line: 5, text: `'x'` }
const NUMBER: Site = { siteId: 'number', line: 6, text: '1' }
const BOOLEAN: Site = { siteId: 'boolean', line: 7, text: 'true' }
const CONST_GENERIC_ELEMENT: Site = { siteId: 'codes', line: 9, text: `'b'` }
const PLAIN_ASSERTION: Site = { siteId: 'asserted', line: 10, text: '"a"' }
const GENERIC_ARROW_BODY: Site = { siteId: 'lazy', line: 11, text: `'x'` }
const ANNOTATED_ELEMENT: Site = { siteId: 'letters', line: 12, text: `'a'` }
const CONST_ASSERTED_UNDER_ANNOTATION: Site = { siteId: 'pair', line: 13, text: 'true' }

const CANDIDATES: ReadonlyArray<readonly [Site, ReadonlyArray<string>]> = [
  [UNION, ['""', '"b"', '0', 'null', 'true', '{}', '`a`']],
  [TUPLE, ['[]', '""', '0', 'undefined']],
  [GENERIC, ['""', '0', 'null']],
  [NUMBER, ['""', '0', '-1', '1n', 'true', 'null', 'undefined', '() => undefined', '() => {}']],
  [BOOLEAN, ['false', '0', '""', 'undefined', '{}']],
  [CONST_GENERIC_ELEMENT, ['""', '0', 'null']],
  [PLAIN_ASSERTION, ['{}', '""', '0']],
  [GENERIC_ARROW_BODY, ['""', '0']],
  [ANNOTATED_ELEMENT, ['""', '"b"', '0']],
  [CONST_ASSERTED_UNDER_ANNOTATION, ['0', '""', 'false']],
]

const ROWS: ReadonlyArray<Row> = CANDIDATES.flatMap(([site, candidates]) =>
  candidates.map((candidate) => ({ site, candidate }))
).map((row, index) => ({ ...row, id: index.toString(16).padStart(16, '0') }))

const locationOf = (content: string, site: Site): TypeQuery.TypeQuerySite['location'] => {
  const column = (content.split('\n')[site.line - 1] ?? '').lastIndexOf(site.text) + 1
  return { start: { line: site.line, column }, end: { line: site.line, column: column + site.text.length } }
}

const sitesContent = Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(SITES_FILE))

const verdictsOf = (rows: ReadonlyArray<Row>): Effect.Effect<Readonly<Record<string, string>>> =>
  Effect.gen(function*() {
    const content = yield* sitesContent
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({ tsconfigFile: TSCONFIG_FILE })
    const wires = yield* S.decodeEffect(S.Array(Checker.CheckerMutantWire))(
      rows.map((row) => ({
        id: row.id,
        fileName: SITES_FILE,
        mutatorName: 'TypeQueryCandidate',
        replacement: row.candidate,
        location: locationOf(content, row.site),
      })),
    )
    const results = yield* Effect.gen(function*() {
      const runtime = yield* CheckerRuntime
      const checker = yield* runtime.checker
      return yield* checker.check([...wires])
    }).pipe(Effect.provide(CheckerRuntime.layer(options)))
    return Object.fromEntries(
      rows.map((row) => [
        row.id,
        Option.match(HashMap.get(results, row.id), { onNone: () => 'missing', onSome: (result) => result.status }),
      ]),
    )
  }).pipe(Effect.provide(FILE_PORTS), Effect.orDie)

const sitesOf = (content: string, rows: ReadonlyArray<Row>): ReadonlyArray<TypeQuery.TypeQuerySite> =>
  Object.values(Arr.groupBy(rows, (row) => row.site.siteId)).map((siteRows) => ({
    siteId: siteRows[0].site.siteId,
    kind: 'expression' as const,
    location: locationOf(content, siteRows[0].site),
    candidates: siteRows.map((row) => ({ candidateId: row.id, text: row.candidate })),
  }))

const requestOf = (content: string, sites: ReadonlyArray<TypeQuery.TypeQuerySite>): TypeQuery.TypeQueryRequest => ({
  version: 1,
  tsconfigFile: TSCONFIG_FILE,
  files: [{ fileName: SITES_FILE, content, sites: [...sites] }],
})

const answerEntriesOf = (
  rows: ReadonlyArray<Row>,
  response: TypeQuery.TypeQueryResponse,
): ReadonlyArray<readonly [string, string]> =>
  response.files.flatMap((outcome): ReadonlyArray<readonly [string, string]> =>
    Match.valueTags(outcome, {
      FileRefused: (refused) => rows.map((row) => [row.id, `FileRefused ${refused.reason}`] as const),
      FileAnswered: (answered) =>
        answered.sites.flatMap((site) =>
          site.candidates.map((candidate) =>
            [
              candidate.candidateId,
              Match.valueTags(candidate.answer, {
                Assignable: () => 'Assignable',
                NotAssignable: () => 'NotAssignable',
                Unknown: (unknown) => `Unknown ${unknown.reason}`,
              }),
            ] as const
          )
        ),
    })
  )

const answersOf = (rows: ReadonlyArray<Row>): Effect.Effect<Readonly<Record<string, string>>> =>
  Effect.gen(function*() {
    const content = yield* sitesContent
    const typeQuery = yield* TypeQuery.TypeQuery
    const response = yield* typeQuery.query(requestOf(content, sitesOf(content, rows)))
    return Object.fromEntries(answerEntriesOf(rows, response))
  }).pipe(Effect.provide(TypeQueryLive), Effect.scoped, Effect.provide(FILE_PORTS), Effect.orDie)

const HOST_BOUND = {
  timeout: 120_000,
  reason: 'the reference builds a real tsgo checker program and the candidate runs a tsgo API server, both on disk',
} as const

Differential.compare({
  name:
    'type query: the fixture is answered, and every NotAssignable answer is a CompileError when the checker applies it',
  reference: verdictsOf,
  candidate: answersOf,
})
  .on(fc.subarray([...ROWS], { minLength: 1 }), { runBudget: 6, hostBound: HOST_BOUND })
  .assert((verdicts, answers) =>
    Object.keys(verdicts).length === Object.keys(answers).length &&
    Object.values(answers).every((answer) => !answer.startsWith('FileRefused')) &&
    Object.entries(answers).every(([id, answer]) => answer !== 'NotAssignable' || verdicts[id] === 'compileError')
  )

interface PerSiteQueries {
  readonly rows: ReadonlyArray<Row>
  readonly concurrency: 1 | 'unbounded'
}

const perSiteAnswersOf = ({ rows, concurrency }: PerSiteQueries) =>
  Effect.gen(function*() {
    const content = yield* sitesContent
    const typeQuery = yield* TypeQuery.TypeQuery
    const responses = yield* Effect.forEach(
      sitesOf(content, rows),
      (site) => typeQuery.query(requestOf(content, [site])),
      { concurrency },
    )
    return Object.fromEntries(responses.flatMap((response) => answerEntriesOf(rows, response)))
  }).pipe(Effect.provide(TypeQueryLive), Effect.scoped, Effect.provide(FILE_PORTS), Effect.orDie)

const SITE_ROWS: ReadonlyArray<ReadonlyArray<Row>> = Object.values(Arr.groupBy(ROWS, (row) => row.site.siteId))

const rowsOnDistinctSites: fc.Arbitrary<ReadonlyArray<Row>> = fc
  .subarray([...SITE_ROWS], { minLength: 2 })
  .chain((sites) => fc.tuple(...sites.map((siteRows) => fc.subarray([...siteRows], { minLength: 1 }))))
  .map((picked) => picked.flat())

Metamorphic.on({
  name: 'type query: concurrent queries on one tsconfig answer as the same queries one at a time',
  system: perSiteAnswersOf,
})
  .relation({
    transformInput: (input) => ({ ...input, concurrency: 'unbounded' }),
    assertOutput: (sequential, concurrent) =>
      Object.values(concurrent).every((answer) => !answer.startsWith('FileRefused')) &&
      Object.keys(sequential).length === Object.keys(concurrent).length &&
      Object.entries(sequential).every(([id, answer]) => concurrent[id] === answer),
  })
  .on(rowsOnDistinctSites.map((rows): PerSiteQueries => ({ rows, concurrency: 1 })), {
    runBudget: 6,
    hostBound: HOST_BOUND,
  })

const BODIES_FIXTURE = decodeURIComponent(new URL('__fixtures__/type-query-bodies/', import.meta.url).pathname)
const BODIES_FILE = `${BODIES_FIXTURE}bodies.ts`
const BODIES_TSCONFIG = `${BODIES_FIXTURE}tsconfig.json`

interface BodyCase {
  readonly id: string
  readonly siteId: string
  readonly marker: string
  readonly bodyText: string
  readonly expected: string
}

type BodyCaseSeed = Omit<BodyCase, 'id'>

const BODY_CASE_SEEDS: ReadonlyArray<BodyCaseSeed> = [
  { siteId: 'plain-number', marker: 'function plainNumber(', bodyText: '{ return 1 }', expected: 'NotAssignable' },
  {
    siteId: 'plain-union',
    marker: 'function plainUnion(',
    bodyText: '{ return 1 }',
    expected: 'Unknown implicit-return-rejected',
  },
  { siteId: 'plain-void', marker: 'function plainVoid(', bodyText: '{ consume() }', expected: 'Assignable' },
  {
    siteId: 'plain-unknown',
    marker: 'function plainUnknown(',
    bodyText: '{ return 1 }',
    expected: 'Unknown implicit-return-rejected',
  },
  { siteId: 'plain-any', marker: 'function plainAny(', bodyText: '{ return 1 }', expected: 'Assignable' },
  {
    siteId: 'plain-never',
    marker: 'function plainNever(',
    bodyText: "{ throw new Error('never') }",
    expected: 'NotAssignable',
  },
  {
    siteId: 'plain-undefined',
    marker: 'function plainUndefined(',
    bodyText: '{ return undefined }',
    expected: 'Assignable',
  },
  { siteId: 'plain-null', marker: 'function plainNull(', bodyText: '{ return null }', expected: 'NotAssignable' },
  {
    siteId: 'async-number',
    marker: 'async function asyncNumber(',
    bodyText: '{ return 1 }',
    expected: 'NotAssignable',
  },
  { siteId: 'async-void', marker: 'async function asyncVoid(', bodyText: '{ return }', expected: 'Assignable' },
  {
    siteId: 'async-union',
    marker: 'async function asyncUnion(',
    bodyText: '{ return 1 }',
    expected: 'Unknown implicit-return-rejected',
  },
  {
    siteId: 'async-unknown',
    marker: 'async function asyncUnknown(',
    bodyText: '{ return 1 }',
    expected: 'Unknown implicit-return-rejected',
  },
  { siteId: 'getter-text', marker: 'get text(', bodyText: "{ return 'a' }", expected: 'NotAssignable' },
  {
    siteId: 'getter-maybe',
    marker: 'get maybe(',
    bodyText: '{ return undefined }',
    expected: 'Unknown getter-requires-return',
  },
  {
    siteId: 'getter-anything',
    marker: 'get anything(',
    bodyText: '{ return 1 }',
    expected: 'Unknown getter-requires-return',
  },
  {
    siteId: 'getter-nothing',
    marker: 'get nothing(',
    bodyText: '{ return }',
    expected: 'Unknown getter-requires-return',
  },
  {
    siteId: 'getter-undef',
    marker: 'get undef(',
    bodyText: '{ return undefined }',
    expected: 'Unknown getter-requires-return',
  },
  { siteId: 'setter-value', marker: 'set value(', bodyText: '{ consume() }', expected: 'Assignable' },
  {
    siteId: 'overloaded-impl',
    marker: 'function overloaded(a: string | number)',
    bodyText: '{ return a }',
    expected: 'NotAssignable',
  },
  {
    siteId: 'overloaded-any-impl',
    marker: 'function overloadedAny(a: any)',
    bodyText: '{ return a }',
    expected: 'Assignable',
  },
  {
    siteId: 'overloaded-signature',
    marker: 'overloaded(a: string): ',
    bodyText: 'string',
    expected: 'Unknown site-not-function-body',
  },
  {
    siteId: 'abstract-method',
    marker: 'abstractMethod(): ',
    bodyText: 'number',
    expected: 'Unknown site-not-function-body',
  },
  {
    siteId: 'declared-method',
    marker: 'declaredMethod(): ',
    bodyText: 'number',
    expected: 'Unknown site-not-function-body',
  },
  { siteId: 'constructor', marker: 'constructor()', bodyText: '{ consume() }', expected: 'Unknown constructor-body' },
  {
    siteId: 'arrow-number',
    marker: 'arrowNumber = (): number => ',
    bodyText: '{ return 1 }',
    expected: 'NotAssignable',
  },
  {
    siteId: 'function-number',
    marker: 'functionNumber = function (',
    bodyText: '{ return 1 }',
    expected: 'NotAssignable',
  },
  { siteId: 'object-method', marker: 'objectMethod = { ', bodyText: '{ return 1 }', expected: 'NotAssignable' },
  {
    siteId: 'this-method',
    marker: 'thisMethod(): this ',
    bodyText: '{ return this }',
    expected: 'Unknown instantiable-target',
  },
  {
    siteId: 'contextual',
    marker: 'contextual: () => number = () => ',
    bodyText: '{ return 1 }',
    expected: 'Unknown return-type-not-declared',
  },
  {
    siteId: 'generic-t',
    marker: 'function genericT<T>(',
    bodyText: '{ return undefined as unknown as T }',
    expected: 'Unknown instantiable-target',
  },
  {
    siteId: 'generic-maybe',
    marker: 'function genericMaybe<T>(',
    bodyText: '{ return undefined }',
    expected: 'Unknown instantiable-target',
  },
  {
    siteId: 'asserts',
    marker: 'function assertThing(',
    bodyText: "{ if (!x) throw new Error('assert') }",
    expected: 'Assignable',
  },
  {
    siteId: 'promise-void',
    marker: 'function promiseVoid(',
    bodyText: '{ return Promise.resolve() }',
    expected: 'NotAssignable',
  },
  { siteId: 'generator', marker: 'function* generate(', bodyText: '{ yield 1 }', expected: 'Unknown generator-body' },
  {
    siteId: 'nested',
    marker: 'function nested(',
    bodyText: '{\n  if (flag) { return 1 }\n  return 2\n}',
    expected: 'NotAssignable',
  },
  {
    siteId: 'nested-inner',
    marker: 'if (flag) ',
    bodyText: '{ return 1 }',
    expected: 'Unknown site-not-function-body',
  },
  {
    siteId: 'arrow-expression',
    marker: 'arrowExpression = (): number => ',
    bodyText: '1',
    expected: 'Unknown site-not-function-body',
  },
  { siteId: 'method', marker: '\n  method(): number ', bodyText: '{ return 1 }', expected: 'NotAssignable' },
]

const BODY_CASES: ReadonlyArray<BodyCase> = BODY_CASE_SEEDS.map((seed, index) => ({
  ...seed,
  id: index.toString(16).padStart(16, '0'),
}))

const bodiesContent = Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(BODIES_FILE))

const lineColumnOf = (content: string, offset: number): { readonly line: number; readonly column: number } => {
  const before = content.slice(0, offset)
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') }
}

const bodySpanOf = (content: string, row: BodyCase): readonly [number, number] => {
  const start = content.indexOf(row.bodyText, content.indexOf(row.marker))
  return [start, start + row.bodyText.length]
}

const bodyLocationOf = (content: string, row: BodyCase): TypeQuery.TypeQuerySite['location'] => {
  const [start, end] = bodySpanOf(content, row)
  return { start: lineColumnOf(content, start), end: lineColumnOf(content, end) }
}

const answerTagOf = (answer: TypeQuery.TypeAnswer): string =>
  Match.valueTags(answer, {
    Assignable: () => 'Assignable',
    NotAssignable: () => 'NotAssignable',
    Unknown: (unknown) => `Unknown ${unknown.reason}`,
  })

const bodyVerdictsOf = (rows: ReadonlyArray<BodyCase>): Effect.Effect<Readonly<Record<string, string>>> =>
  Effect.gen(function*() {
    const content = yield* bodiesContent
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({ tsconfigFile: BODIES_TSCONFIG })
    const wires = yield* S.decodeEffect(S.Array(Checker.CheckerMutantWire))(
      rows.map((row) => ({
        id: row.id,
        fileName: BODIES_FILE,
        mutatorName: 'BlockStatement',
        replacement: '{}',
        location: bodyLocationOf(content, row),
      })),
    )
    const results = yield* Effect.gen(function*() {
      const runtime = yield* CheckerRuntime
      const checker = yield* runtime.checker
      return yield* checker.check([...wires])
    }).pipe(Effect.provide(CheckerRuntime.layer(options)))
    return Object.fromEntries(
      rows.map((row) => [
        row.id,
        Option.match(HashMap.get(results, row.id), { onNone: () => 'missing', onSome: (result) => result.status }),
      ]),
    )
  }).pipe(Effect.provide(FILE_PORTS), Effect.orDie)

const bodyAnswersOf = (rows: ReadonlyArray<BodyCase>): Effect.Effect<Readonly<Record<string, string>>> =>
  Effect.gen(function*() {
    const content = yield* bodiesContent
    const typeQuery = yield* TypeQuery.TypeQuery
    const response = yield* typeQuery.query({
      version: 2,
      tsconfigFile: BODIES_TSCONFIG,
      files: [{
        fileName: BODIES_FILE,
        content,
        sites: rows.map((row) => ({
          siteId: row.siteId,
          kind: 'function-body' as const,
          location: bodyLocationOf(content, row),
          candidates: [{ candidateId: row.id, text: '{}' }],
        })),
      }],
    })
    return Object.fromEntries(
      response.files.flatMap((outcome): ReadonlyArray<readonly [string, string]> =>
        Match.valueTags(outcome, {
          FileRefused: (refused) => rows.map((row) => [row.id, `FileRefused ${refused.reason}`] as const),
          FileAnswered: (answered) =>
            answered.sites.flatMap((site) =>
              site.candidates.map((candidate) => [candidate.candidateId, answerTagOf(candidate.answer)] as const)
            ),
        })
      ),
    )
  }).pipe(Effect.provide(TypeQueryLive), Effect.scoped, Effect.provide(FILE_PORTS), Effect.orDie)

const expectedOf = (id: string): string => BODY_CASES.find((row) => row.id === id)?.expected ?? 'no-case'

Differential.compare({
  name: 'type query: version-2 function-body sites pin every contract case and every NotAssignable is a CompileError',
  reference: bodyVerdictsOf,
  candidate: bodyAnswersOf,
})
  .on(fc.shuffledSubarray([...BODY_CASES], { minLength: BODY_CASES.length }), { runBudget: 2, hostBound: HOST_BOUND })
  .assert((verdicts, answers) =>
    Object.keys(answers).length === Object.keys(verdicts).length &&
    Object.values(answers).every((answer) => !answer.startsWith('FileRefused')) &&
    Object.entries(answers).every(([id, answer]) => answer === expectedOf(id)) &&
    Object.entries(answers).every(([id, answer]) => answer !== 'NotAssignable' || verdicts[id] === 'compileError')
  )
