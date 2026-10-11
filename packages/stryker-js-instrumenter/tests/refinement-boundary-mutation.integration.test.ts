import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Effect } from 'effect'

import { instrument, stockOptions } from './__fixtures__/instrument.js'

const REFINEMENT_BOUNDARY = 'RefinementBoundary'

const schemaModule = (body: string): string =>
  `import * as S from 'effect/Schema'

${body}
`

const SHIFTED_CASES = [
  {
    site: 'positive amount guarded by an exclusive lower bound',
    source: schemaModule('export const Amount = S.Number.check(S.isGreaterThan(0))'),
    replacements: ['S.isGreaterThanOrEqualTo(0)'],
  },
  {
    site: 'non-negative count guarded by an inclusive lower bound',
    source: schemaModule('export const Count = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))'),
    replacements: ['S.isGreaterThan(0)'],
  },
  {
    site: 'percentage capped by an exclusive upper bound',
    source: `import { Schema } from 'effect'

export const Ratio = Schema.Number.check(Schema.isLessThan(100))
`,
    replacements: ['Schema.isLessThanOrEqualTo(100)'],
  },
  {
    site: 'exit code capped by an inclusive upper bound with its annotation',
    source: schemaModule("export const ExitCode = S.Int.check(S.isLessThanOrEqualTo(255, { title: 'exit code' }))"),
    replacements: ["S.isLessThan(255, { title: 'exit code' })"],
  },
  {
    site: 'digit range with no exclusivity flag',
    source: schemaModule('export const Digit = S.Int.check(S.isBetween({ minimum: 1, maximum: 9 }))'),
    replacements: [
      'S.isBetween({ minimum: 1, maximum: 9, exclusiveMinimum: true })',
      'S.isBetween({ minimum: 1, maximum: 9, exclusiveMaximum: true })',
    ],
  },
  {
    site: 'fill fraction whose lower bound is already exclusive',
    source: schemaModule(
      'export const Fill = S.Finite.check(S.isBetween({ minimum: 0, maximum: 1, exclusiveMinimum: true }))',
    ),
    replacements: [
      'S.isBetween({ minimum: 0, maximum: 1, exclusiveMinimum: false })',
      'S.isBetween({ minimum: 0, maximum: 1, exclusiveMinimum: true, exclusiveMaximum: true })',
    ],
  },
  {
    site: 'pair that needs at least two characters',
    source: schemaModule('export const Pair = S.String.check(S.isMinLength(2))'),
    replacements: ['S.isMinLength(2 + 1)'],
  },
  {
    site: 'short code that allows at most five characters',
    source: schemaModule('export const Code = S.String.check(S.isMaxLength(5))'),
    replacements: ['S.isMaxLength(5 - 1)'],
  },
] as const

const REFUSAL_CASES = [
  {
    situation: 'a local function named isGreaterThan',
    source: `const isGreaterThan = (n: number) => (x: number) => x > n

export const positive = isGreaterThan(0)
`,
  },
  {
    situation: 'a bare isGreaterThan import with no Schema module in scope to reach the swap',
    source: `import { isGreaterThan } from 'effect/Schema'

export const positive = isGreaterThan(0)
`,
  },
  {
    situation: 'a parameter shadowing the Schema namespace',
    source: `import * as S from 'effect/Schema'

export const shadowed = (S: { isGreaterThan: (n: number) => number }) => S.isGreaterThan(0)
`,
  },
  {
    situation: 'a maximum length of zero, which Schema reads the same one lower',
    source: schemaModule('export const Empty = S.String.check(S.isMaxLength(0))'),
  },
  {
    situation: 'isBetween options held in a variable',
    source: schemaModule(`const range = { minimum: 1, maximum: 9 }

export const Digit = S.Int.check(S.isBetween(range))`),
  },
  {
    situation: 'isBetween options that spread another object',
    source: schemaModule(`const flags = { exclusiveMinimum: true }

export const Digit = S.Int.check(S.isBetween({ ...flags, minimum: 1, maximum: 9 }))`),
  },
] as const

const instrumentSource = (source: string) =>
  instrument(
    [{ name: '/tmp/refinement-boundary-probe.ts', content: source, mutate: true }],
    stockOptions({ ignorers: [], excludedMutations: [] }),
  )

const boundaryMutantsOf = (result: { readonly mutants: readonly Mutant.Mutant[] }): readonly Mutant.Mutant[] =>
  result.mutants.filter((mutant) => mutant.mutatorName === REFINEMENT_BOUNDARY)

const Feature = makeFeature({ it })

Feature('Moving each Schema bound by one inclusivity step')
  .live('parses real source with the oxc parser')
  .withLayer(NodeFileSystem.layer)
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'The <site> yields one mutant per bound it can move',
      SHIFTED_CASES,
      (row) =>
        Gherkin.Do.pipe(
          Given('a module with one Schema bound')('source', () => Effect.succeed(row.source)),
          When('the module is instrumented with the default mutators')(
            'mutants',
            ({ source }: { source: string }) => Effect.map(instrumentSource(source), boundaryMutantsOf),
          ),
          Then('the proposed mutants spell the moved bounds word for word')(
            ({ mutants }: { mutants: readonly Mutant.Mutant[] }, expect) =>
              expect(mutants.map((mutant) => mutant.replacement)).toEqual([...row.replacements]),
          ),
        ),
    )

    scenarioOutline(
      'A <situation> is left alone',
      REFUSAL_CASES,
      (row) =>
        Gherkin.Do.pipe(
          Given(row.situation)('source', () => Effect.succeed(row.source)),
          When('the module is instrumented with the default mutators')(
            'count',
            ({ source }: { source: string }) =>
              Effect.map(instrumentSource(source), (result) => boundaryMutantsOf(result).length),
          ),
          Then('no mutant is proposed')(({ count }: { count: number }, expect) => expect(count).toBe(0)),
        ),
    )
  })
