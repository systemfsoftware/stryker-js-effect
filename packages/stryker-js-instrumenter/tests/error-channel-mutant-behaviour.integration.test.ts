import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect, Exit, FileSystem, Option } from 'effect'

import type * as Lookup from '../testResources/effect-error-channel/lookup.js'
import { FixtureImportError } from './__fixtures__/concurrency-mutant-behaviour.schema.js'
import { instrument, stockOptions } from './__fixtures__/instrument.js'

type LookupModule = typeof Lookup
type Outcome = number | string

const FIXTURE_URL = new URL('../testResources/effect-error-channel/lookup.ts', import.meta.url)
const SCRATCH_URL = new URL('../.scratch/error-channel-behaviour/', import.meta.url)

interface Assertion {
  readonly run: (module: LookupModule) => Effect.Effect<Outcome, Lookup.NotFound>
  readonly holds: (exit: Exit.Exit<Outcome, Lookup.NotFound>) => boolean
}

interface Specification {
  readonly mutator: string
  readonly pinning: Assertion
  readonly loose: Assertion
}

const succeedsWith = (expected: Outcome) => (exit: Exit.Exit<Outcome, Lookup.NotFound>): boolean =>
  Exit.isSuccess(exit) && exit.value === expected

const SPECIFICATIONS = [
  {
    mutator: 'RecoveryRemoval',
    pinning: { run: (module: LookupModule) => module.withFallback(false), holds: succeedsWith(0) },
    loose: { run: (module: LookupModule) => module.withFallback(true), holds: succeedsWith(42) },
  },
  {
    mutator: 'FailureToDefect',
    pinning: {
      run: (module: LookupModule) =>
        module.lookup(false).pipe(Effect.catchTag('NotFound', () => Effect.succeed('recovered'))),
      holds: succeedsWith('recovered'),
    },
    loose: { run: (module: LookupModule) => module.lookup(false), holds: Exit.isFailure },
  },
] as const satisfies ReadonlyArray<Specification>

interface Harness {
  readonly module: LookupModule
  readonly mutantId: string
}

interface Verdicts {
  readonly pinning: { readonly original: boolean; readonly mutant: boolean }
  readonly loose: { readonly original: boolean; readonly mutant: boolean }
}

const isLookupModule = (u: unknown): u is LookupModule =>
  typeof u === 'object' && u !== null && 'lookup' in u && 'withFallback' in u

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

const holdsUnder = (harness: Harness, id: string | undefined, assertion: Assertion): Effect.Effect<boolean> =>
  Effect.flatMap(setActiveMutant(id), () =>
    Effect.ensuring(
      Effect.map(Effect.exit(Effect.suspend(() => assertion.run(harness.module))), assertion.holds),
      setActiveMutant(undefined),
    ))

const verdictsOf = (harness: Harness, specification: Specification): Effect.Effect<Verdicts> =>
  Effect.all({
    pinning: Effect.all({
      original: holdsUnder(harness, undefined, specification.pinning),
      mutant: holdsUnder(harness, harness.mutantId, specification.pinning),
    }),
    loose: Effect.all({
      original: holdsUnder(harness, undefined, specification.loose),
      mutant: holdsUnder(harness, harness.mutantId, specification.loose),
    }),
  })

const instrumentedHarness = (mutator: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const content = yield* fs.readFileString(FIXTURE_URL.pathname)
    const result = yield* instrument(
      [{ name: 'lookup.ts', content, mutate: true }],
      stockOptions({ ignorers: [], excludedMutations: [] }),
    )
    const directory = new URL(`${mutator}/`, SCRATCH_URL)
    const target = new URL('lookup.ts', directory)
    yield* fs.makeDirectory(directory.pathname, { recursive: true })
    yield* fs.writeFileString(target.pathname, result.files[0]?.content ?? '')
    const module = yield* Effect.ensuring(
      Effect.filterOrFail(
        Effect.tryPromise({
          try: () => import(target.href),
          catch: () => FixtureImportError.make({ url: target.href }),
        }),
        isLookupModule,
        () => FixtureImportError.make({ url: target.href }),
      ),
      Effect.ignore(fs.remove(directory.pathname, { recursive: true, force: true })),
    )
    const mutantIds = result.mutants.filter((mutant) => mutant.mutatorName === mutator).map((mutant) => mutant.id)
    return { module, mutantIds }
  })

const Feature = makeFeature({ it })

Feature('Telling apart tests that pin the error channel from tests that only touch it')
  .live('the harness writes a real instrumented module to disk and loads it at run time')
  .withLayer(NodeFileSystem.layer)
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'A test pinning the error channel kills the <mutator> mutant, and a looser test lets it survive',
      SPECIFICATIONS,
      (specification) =>
        Gherkin.Do.pipe(
          Given('the lookup module instrumented with the default mutators')(
            'instrumented',
            () => instrumentedHarness(specification.mutator),
          ),
          When('both tests run against the original and against the one mutant')(
            'verdicts',
            ({ instrumented }) =>
              Effect.map(
                verdictsOf({ module: instrumented.module, mutantId: instrumented.mutantIds[0] ?? '' }, specification),
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
