import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect, Exit, FileSystem, Option } from 'effect'
import * as Arbitrary from 'effect/Arbitrary'
import * as S from 'effect/Schema'

import type * as Amounts from '../testResources/effect-schema-refinement/amounts.js'
import { FixtureImportError } from './__fixtures__/concurrency-mutant-behaviour.schema.js'
import { instrument, stockOptions } from './__fixtures__/instrument.js'

type AmountsModule = typeof Amounts
type SchemaFactory = keyof AmountsModule

const FIXTURE_URL = new URL('../testResources/effect-schema-refinement/amounts.ts', import.meta.url)
const SCRATCH_URL = new URL('../.scratch/schema-refinement-behaviour/', import.meta.url)

type Assertion = (module: AmountsModule) => Effect.Effect<boolean>

interface Specification {
  readonly mutator: string
  readonly factory: SchemaFactory
  readonly pinning: Assertion
  readonly loose: Assertion
}

type Input = number | string

const decodes = (factory: SchemaFactory, input: Input): Assertion => (module) =>
  Effect.sync(() => Exit.isSuccess(S.decodeExit(module[factory]())(input)))

const refuses = (factory: SchemaFactory, input: Input): Assertion => (module) =>
  Effect.map(decodes(factory, input)(module), (accepted) => !accepted)

const acceptsWhatItGenerates = (factory: 'positiveAmount'): Assertion => (module) => {
  const schema = module[factory]()
  return Effect.map(
    Arbitrary.checkEffect(
      Arbitrary.schema(schema),
      (value) => Exit.isSuccess(S.decodeExit(schema)(value)),
      { runs: 200 },
    ),
    (result) => Arbitrary.formatCheckFailure(result) === undefined,
  )
}

const SPECIFICATIONS = [
  {
    mutator: 'RefinementBoundary',
    factory: 'positiveAmount',
    pinning: refuses('positiveAmount', 0),
    loose: acceptsWhatItGenerates('positiveAmount'),
  },
  {
    mutator: 'RefinementBoundary',
    factory: 'pairCode',
    pinning: decodes('pairCode', 'ab'),
    loose: decodes('pairCode', 'abcdef'),
  },
  {
    mutator: 'RefinementRemoval',
    factory: 'wholeCount',
    pinning: refuses('wholeCount', 1.5),
    loose: decodes('wholeCount', 2),
  },
] as const satisfies ReadonlyArray<Specification>

interface Verdicts {
  readonly pinning: { readonly original: boolean; readonly mutant: boolean }
  readonly loose: { readonly original: boolean; readonly mutant: boolean }
}

const isAmountsModule = (u: unknown): u is AmountsModule =>
  typeof u === 'object' && u !== null && 'positiveAmount' in u && 'pairCode' in u && 'wholeCount' in u

const hostNamespace = (): object =>
  Option.getOrElse(
    Option.liftPredicate((u: unknown): u is object => typeof u === 'object' && u !== null)(
      Reflect.get(globalThis, Instrument.InstrumenterContext.NAMESPACE),
    ),
    () => {
      const created: Record<string, string | undefined> = {}
      Reflect.set(globalThis, Instrument.InstrumenterContext.NAMESPACE, created)
      return created
    },
  )

const setActiveMutant = (id: string | undefined): Effect.Effect<void> =>
  Effect.sync(() => Reflect.set(hostNamespace(), Instrument.InstrumenterContext.ACTIVE_MUTANT, id))

const holdsUnder = (
  module: AmountsModule,
  id: string | undefined,
  assertion: Assertion,
): Effect.Effect<boolean> =>
  Effect.flatMap(
    setActiveMutant(id),
    () => Effect.ensuring(Effect.suspend(() => assertion(module)), setActiveMutant(undefined)),
  )

const verdictsOf = (module: AmountsModule, mutantId: string, specification: Specification): Effect.Effect<Verdicts> =>
  Effect.all({
    pinning: Effect.all({
      original: holdsUnder(module, undefined, specification.pinning),
      mutant: holdsUnder(module, mutantId, specification.pinning),
    }),
    loose: Effect.all({
      original: holdsUnder(module, undefined, specification.loose),
      mutant: holdsUnder(module, mutantId, specification.loose),
    }),
  })

const lineOf = (content: string, factory: SchemaFactory): number =>
  content.split('\n').findIndex((line) => line.startsWith(`export const ${factory} =`)) + 1

const instrumentedHarness = (specification: Specification) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const content = yield* fs.readFileString(FIXTURE_URL.pathname)
    const result = yield* instrument(
      [{ name: 'amounts.ts', content, mutate: true }],
      stockOptions({ ignorers: [], excludedMutations: [] }),
    )
    const directory = new URL(`${specification.mutator}-${specification.factory}/`, SCRATCH_URL)
    const target = new URL('amounts.ts', directory)
    yield* fs.makeDirectory(directory.pathname, { recursive: true })
    yield* fs.writeFileString(target.pathname, result.files[0]?.content ?? '')
    const module = yield* Effect.ensuring(
      Effect.filterOrFail(
        Effect.tryPromise({
          try: () => import(target.href),
          catch: () => FixtureImportError.make({ url: target.href }),
        }),
        isAmountsModule,
        () => FixtureImportError.make({ url: target.href }),
      ),
      Effect.ignore(fs.remove(directory.pathname, { recursive: true, force: true })),
    )
    const line = lineOf(content, specification.factory)
    const mutantIds = result.mutants
      .filter((mutant) => mutant.mutatorName === specification.mutator && mutant.location.start.line === line)
      .map((mutant) => mutant.id)
    return { module, mutantIds }
  })

const Feature = makeFeature({ it })

Feature('Telling apart schema tests that pin a refinement from tests that only exercise it')
  .live('the harness writes a real instrumented module to disk and loads it at run time')
  .withLayer(NodeFileSystem.layer)
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'A test pinning <factory> kills the <mutator> mutant, and a looser test lets it survive',
      SPECIFICATIONS,
      (specification) =>
        Gherkin.Do.pipe(
          Given('the amounts module instrumented with the default mutators')(
            'instrumented',
            () => instrumentedHarness(specification),
          ),
          When('both tests run against the original and against the one mutant')(
            'verdicts',
            ({ instrumented }) =>
              Effect.map(
                verdictsOf(instrumented.module, instrumented.mutantIds[0] ?? '', specification),
                (verdicts) => ({ mutants: instrumented.mutantIds.length, verdicts }),
              ),
          ),
          Then('the pinning test fails only on the mutant, and the looser test passes on both')(
            ({ verdicts }, expect) =>
              expect(verdicts).toStrictEqual({
                mutants: 1,
                verdicts: {
                  pinning: { original: true, mutant: false },
                  loose: { original: true, mutant: true },
                },
              }),
          ),
        ),
    )
  })
