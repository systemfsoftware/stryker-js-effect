import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, Layer } from 'effect'
import * as Match from 'effect/Match'
import { expect } from 'vitest'

import { cloneNode, isExpressionKind } from '../src/Ast.js'
import { defaultMutators, type Mutator, type MutatorRegistry, selectMutators } from '../src/Mutator.js'
import { parseWithOxc } from '../src/Parser.js'
import type { ParseFailed } from '../src/Parser.js'
import { createMutantCollector, type MutantCollector, transform, transformScript } from '../src/Transformer.js'

const noMutants: Mutator = () => []

const dummyMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isExpressionKind, (expression) => [cloneNode(expression)]),
    Match.orElse(() => []),
  )

const STAND_IN_NAMES: readonly string[] = ['StandInA', 'StandInB', 'StandInC']

const DUMMY_NAME = 'Dummy'

const ALL_OPT_IN_NAMES: readonly string[] = [...STAND_IN_NAMES, DUMMY_NAME]

const testRegistry: MutatorRegistry = Object.freeze({
  defaults: defaultMutators,
  optIn: Object.freeze({
    StandInA: noMutants,
    StandInB: noMutants,
    StandInC: noMutants,
    Dummy: dummyMutator,
  }),
})

const DEFAULT_NAMES: readonly string[] = [
  'ArithmeticOperator',
  'ArrayDeclaration',
  'ArrowFunction',
  'AssignmentOperator',
  'BlockStatement',
  'BooleanLiteral',
  'ConditionalExpression',
  'EqualityOperator',
  'LogicalOperator',
  'MethodExpression',
  'ObjectLiteral',
  'OptionalChaining',
  'Regex',
  'StringLiteral',
  'UnaryOperator',
  'UpdateOperator',
]

interface SelectionCase {
  readonly label: string
  readonly request: readonly string[]
  readonly namedOptIns: readonly string[]
}

const SELECTION_CASES: readonly SelectionCase[] = [
  { label: 'nothing named', request: [], namedOptIns: [] },
  { label: 'the first stand-in named', request: ['StandInA'], namedOptIns: ['StandInA'] },
  { label: 'the second stand-in named', request: ['StandInB'], namedOptIns: ['StandInB'] },
  { label: 'the third stand-in named', request: ['StandInC'], namedOptIns: ['StandInC'] },
  { label: 'the Dummy named', request: [DUMMY_NAME], namedOptIns: [DUMMY_NAME] },
  {
    label: 'the three stand-ins named',
    request: ['StandInA', 'StandInB', 'StandInC'],
    namedOptIns: ['StandInA', 'StandInB', 'StandInC'],
  },
  {
    label: 'the Dummy named before a stand-in',
    request: [DUMMY_NAME, 'StandInA'],
    namedOptIns: ['StandInA', DUMMY_NAME],
  },
  {
    label: 'every extra named',
    request: ['StandInA', 'StandInB', 'StandInC', DUMMY_NAME],
    namedOptIns: ['StandInA', 'StandInB', 'StandInC', DUMMY_NAME],
  },
]

const PROBE_SOURCE = 'const sum = 1 + 2\nconst doubled = sum * 2\n'

const SUPPRESSED_PROBE = `import { Effect, Ref } from 'effect'

// Stryker disable next-line AtomicUpdateSplit: race proven elsewhere
export const bump = (ref: Ref.Ref<number>): Effect.Effect<void> => Ref.update(ref, (n) => n + 1)
`

const UNKNOWN_DIRECTIVE_PROBE = `export const a = 1 + 1
// Stryker disable next-line NoSuchMutator
export const b = 2 + 2
`

interface TransformOutcome {
  readonly warnings: readonly string[]
  readonly mutants: MutantCollector
}

const runThroughTransformScript = (
  source: string,
  optInMutations: readonly string[],
  registry?: MutatorRegistry,
): Effect.Effect<TransformOutcome, ParseFailed> =>
  Effect.flatMap(parseWithOxc(source, 'probe.ts', 'ts'), (parsed) => {
    const collector = createMutantCollector()
    return Effect.map(
      transformScript(
        {
          format: 'ts',
          root: parsed.root,
          comments: parsed.comments,
          rawContent: source,
          originFileName: 'probe.ts',
        },
        collector,
        { transform, options: { excludedMutations: [], ignorers: [], optInMutations }, mutateDescription: true },
        registry,
      ),
      (warnings) => ({ warnings, mutants: collector }),
    )
  })

interface ProbeRun {
  readonly label: string
  readonly dummyExpected: boolean
  readonly names: readonly string[]
}

interface SelectionOutcome {
  readonly label: string
  readonly namedOptIns: readonly string[]
  readonly activeNames: readonly string[]
  readonly known: readonly string[]
}

const Feature = makeFeature({ it, layer })

Feature('Directing a mutation run to apply extra mutators by name')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A run that names extras applies every default first, then exactly the named extras in registry order',
      Gherkin.Do.pipe(
        Given('a registry of three silent stand-ins and a mutating Dummy beside the defaults')(
          'registry',
          () => Effect.succeed(testRegistry),
        ),
        When('the mutators are selected for each named request')(
          'outcomes',
          ({ registry }: { registry: MutatorRegistry }) =>
            Effect.succeed(
              SELECTION_CASES.map((selectionCase): SelectionOutcome => {
                const selection = selectMutators(registry, selectionCase.request)
                return {
                  label: selectionCase.label,
                  namedOptIns: selectionCase.namedOptIns,
                  activeNames: selection.active.map(([name]) => name),
                  known: selection.known,
                }
              }),
            ),
        ),
        Then(
          'the defaults lead, each named extra follows in registry order, and every name stays speakable in a directive',
        )((
          { registry, outcomes }: { registry: MutatorRegistry; outcomes: readonly SelectionOutcome[] },
        ) =>
          Effect.sync(() => {
            expect(DEFAULT_NAMES).toStrictEqual(Object.keys(registry.defaults))
            for (const outcome of outcomes) {
              expect(outcome.activeNames, outcome.label).toStrictEqual([...DEFAULT_NAMES, ...outcome.namedOptIns])
              expect(outcome.known, outcome.label).toStrictEqual([...DEFAULT_NAMES, ...ALL_OPT_IN_NAMES])
            }
          })
        ),
      ),
    )

    scenario(
      'A name given twice still selects its mutator once',
      Gherkin.Do.pipe(
        Given('the same registry of stand-ins and Dummy')('registry', () => Effect.succeed(testRegistry)),
        When('the second stand-in is named twice')(
          'activeNames',
          ({ registry }: { registry: MutatorRegistry }) =>
            Effect.succeed(selectMutators(registry, ['StandInB', 'StandInB']).active.map(([name]) => name)),
        ),
        Then('the selection closes with that stand-in exactly once')((
          { activeNames }: { activeNames: readonly string[] },
        ) => Effect.sync(() => expect(activeNames).toStrictEqual([...DEFAULT_NAMES, 'StandInB']))),
      ),
    )

    scenario(
      'A probe module with two arithmetic expressions still mutates normally when nothing extra is named',
      Gherkin.Do.pipe(
        Given('the probe module')('source', () => Effect.succeed(PROBE_SOURCE)),
        When('the probe runs through the transformation with nothing named')(
          'outcome',
          ({ source }: { source: string }) => runThroughTransformScript(source, []),
        ),
        Then('each expression carries exactly one arithmetic mutant')(({ outcome }: { outcome: TransformOutcome }) =>
          Effect.sync(() =>
            expect(outcome.mutants.map((mutant) => mutant.mutatorName)).toStrictEqual([
              'ArithmeticOperator',
              'ArithmeticOperator',
            ])
          )
        ),
      ),
    )

    scenario(
      'Only the Dummy leaves a mark on the probe, and only while it is named',
      Gherkin.Do.pipe(
        Given('the probe module')('source', () => Effect.succeed(PROBE_SOURCE)),
        When('the probe is transformed unnamed, with the Dummy named, and with only the silent stand-ins named')(
          'runs',
          ({ source }: { source: string }) =>
            Effect.forEach(
              [
                { label: 'unnamed', request: [] as readonly string[], dummyExpected: false },
                { label: 'with the Dummy named', request: [DUMMY_NAME], dummyExpected: true },
                { label: 'with only the silent stand-ins named', request: STAND_IN_NAMES, dummyExpected: false },
              ],
              (run) =>
                Effect.map(runThroughTransformScript(source, run.request, testRegistry), (outcome): ProbeRun => ({
                  label: run.label,
                  dummyExpected: run.dummyExpected,
                  names: outcome.mutants.map((mutant) => mutant.mutatorName),
                })),
            ),
        ),
        Then('the Dummy appears exactly while named, and the silent stand-ins never do')((
          { runs }: { runs: readonly ProbeRun[] },
        ) =>
          Effect.sync(() => {
            for (const run of runs) {
              expect(run.names.includes(DUMMY_NAME), `${run.label}: Dummy presence`).toBe(run.dummyExpected)
              for (const standIn of STAND_IN_NAMES) {
                expect(run.names.includes(standIn), `${run.label}: ${standIn} presence`).toBe(false)
              }
            }
          })
        ),
      ),
    )

    scenario(
      'A disable comment naming the concurrency mutator draws no warning, whether or not the run named it',
      Gherkin.Do.pipe(
        Given('a module whose update call sits under a disable comment giving a reason')(
          'source',
          () => Effect.succeed(SUPPRESSED_PROBE),
        ),
        When('the module is transformed unnamed and with the concurrency mutator named')(
          'runs',
          ({ source }: { source: string }) =>
            Effect.all([
              runThroughTransformScript(source, []),
              runThroughTransformScript(source, ['AtomicUpdateSplit']),
            ]),
        ),
        Then(
          'no warning is raised either way, and the named run still finds the suppressed mutant carrying its reason',
        )((
          { runs }: { runs: readonly [TransformOutcome, TransformOutcome] },
        ) =>
          Effect.sync(() => {
            const [unnamed, named] = runs
            expect(unnamed.warnings).toStrictEqual([])
            expect(named.warnings).toStrictEqual([])
            const suppressed = named.mutants.filter((mutant) => mutant.mutatorName === 'AtomicUpdateSplit')
            expect(suppressed.length).toBe(1)
            expect(suppressed[0]?.ignoreReason).toBe('race proven elsewhere')
          })
        ),
      ),
    )

    scenario(
      'A disable comment naming an unknown mutator warns exactly once',
      Gherkin.Do.pipe(
        Given('a module whose arithmetic sits under a disable comment naming an unknown mutator')(
          'source',
          () => Effect.succeed(UNKNOWN_DIRECTIVE_PROBE),
        ),
        When('the module is transformed with nothing named')(
          'outcome',
          ({ source }: { source: string }) => runThroughTransformScript(source, []),
        ),
        Then('one warning names the unknown mutator')(({ outcome }: { outcome: TransformOutcome }) =>
          Effect.sync(() => {
            expect(outcome.warnings.length).toBe(1)
            expect(outcome.warnings[0] ?? '').toContain("'NoSuchMutator'")
          })
        ),
      ),
    )
  })
