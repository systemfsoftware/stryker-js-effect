import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Effect } from 'effect'

import { instrument, stockOptions } from './__fixtures__/instrument.js'

const REFINEMENT_REMOVAL = 'RefinementRemoval'

const schemaModule = (body: string): string =>
  `import * as S from 'effect/Schema'

${body}
`

const REMOVAL_CASES = [
  {
    site: 'slug that must be non-empty and lowercase',
    source: schemaModule('export const Slug = S.String.check(S.isMinLength(1), S.isPattern(/^[a-z]+$/))'),
    replacements: ['S.String.check(S.isPattern(/^[a-z]+$/))', 'S.String.check(S.isMinLength(1))'],
  },
  {
    site: 'whole-number count with its one check',
    source: schemaModule('export const Count = S.Number.check(S.isInt())'),
    replacements: ['S.Number'],
  },
  {
    site: 'piped non-negative line number',
    source: schemaModule('export const Line = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))'),
    replacements: ['self => self'],
  },
  {
    site: 'piped exit code with two checks',
    source: `import { pipe, Schema } from 'effect'

export const ExitCode = pipe(Schema.Number, Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 255 })))
`,
    replacements: ['Schema.check(Schema.isBetween({ minimum: 0, maximum: 255 }))', 'Schema.check(Schema.isInt())'],
  },
  {
    site: 'non-empty list built by a Schema constructor',
    source: schemaModule('export const Names = S.Array(S.String).check(S.isMinLength(1))'),
    replacements: ['S.Array(S.String)'],
  },
] as const

const REFUSAL_CASES = [
  {
    situation: 'a check method on a local object',
    source: `const box = { check: (n: number) => n > 0 }

export const checked = box.check(1)
`,
  },
  {
    situation: 'a lone Schema check outside a pipe',
    source: schemaModule('export const positive = S.check(S.isGreaterThan(0))'),
  },
  {
    situation: 'a parameter shadowing the Schema namespace',
    source: `import * as S from 'effect/Schema'

export const shadowed = (S: { String: { check: (n: number) => number } }) => S.String.check(1)
`,
  },
] as const

const instrumentSource = (source: string) =>
  instrument(
    [{ name: '/tmp/refinement-removal-probe.ts', content: source, mutate: true }],
    stockOptions({ ignorers: [], excludedMutations: [] }),
  )

const removalMutantsOf = (result: { readonly mutants: readonly Mutant.Mutant[] }): readonly Mutant.Mutant[] =>
  result.mutants.filter((mutant) => mutant.mutatorName === REFINEMENT_REMOVAL)

const Feature = makeFeature({ it })

Feature('Removing one Schema refinement so the schema accepts what it refused')
  .live('parses real source with the oxc parser')
  .withLayer(NodeFileSystem.layer)
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'The <site> loses one check per mutant',
      REMOVAL_CASES,
      (row) =>
        Gherkin.Do.pipe(
          Given('a module with one Schema check call')('source', () => Effect.succeed(row.source)),
          When('the module is instrumented with the default mutators')(
            'mutants',
            ({ source }: { source: string }) => Effect.map(instrumentSource(source), removalMutantsOf),
          ),
          Then('the proposed mutants spell the remaining schema word for word')(
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
              Effect.map(instrumentSource(source), (result) => removalMutantsOf(result).length),
          ),
          Then('no mutant is proposed')(({ count }: { count: number }, expect) => expect(count).toBe(0)),
        ),
    )
  })
