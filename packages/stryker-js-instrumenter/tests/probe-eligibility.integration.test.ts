import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Effect, Layer } from 'effect'

import { stockOptions } from './__fixtures__/instrument.js'

const probed = (kind: Mutant.ProbeKind): Mutant.ProbeEligibility => ({ _tag: 'Probed', kind })
const unprobed = (reason: Mutant.UnprobedReason): Mutant.ProbeEligibility => ({ _tag: 'Unprobed', reason })

const IN_CONDITION = (test: string, parameters: string): string =>
  `export const f = (${parameters}): number => {\n  if (${test}) {\n    return 1\n  }\n  return 0\n}\n`

const Feature = makeFeature({ it })

Feature('Marking which mutants a dry run can probe')
  .live('parses real source with the oxc parser loaded at run time')
  .withLayer(Layer.empty)
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'The <mutator> mutants of <site> carry their probe state',
      [
        {
          site: 'a subtraction',
          source: 'export const f = (a: number, b: number): number => a - b\n',
          mutator: 'ArithmeticOperator',
          expected: [['a + b', probed('arithmetic')]],
        },
        {
          site: 'an addition',
          source: 'export const f = (a: number, b: number): number => a + b\n',
          mutator: 'ArithmeticOperator',
          expected: [['a - b', unprobed('operator-not-probed')]],
        },
        {
          site: 'a string concatenation',
          source: "export const f = (name: string): string => 'hi ' + name\n",
          mutator: 'ArithmeticOperator',
          expected: [],
        },
        {
          site: 'a negation',
          source: 'export const f = (a: number): number => -a\n',
          mutator: 'UnaryOperator',
          expected: [['+a', probed('unary')]],
        },
        {
          site: 'a bitwise not',
          source: 'export const f = (a: number): number => ~a\n',
          mutator: 'UnaryOperator',
          expected: [['a', unprobed('operator-not-probed')]],
        },
        {
          site: 'a strict equality',
          source: 'export const f = (a: number, b: number): boolean => a === b\n',
          mutator: 'EqualityOperator',
          expected: [['a !== b', unprobed('every-reach-infects')]],
        },
        {
          site: 'a relational condition',
          source: IN_CONDITION('a < b', 'a: number, b: number'),
          mutator: 'EqualityOperator',
          expected: [
            ['a <= b', probed('relational')],
            ['a >= b', probed('relational')],
            ['a != b', probed('relational')],
          ],
        },
        {
          site: 'a condition over parameters',
          source: IN_CONDITION('a < b', 'a: number, b: number'),
          mutator: 'ConditionalExpression',
          expected: [['true', unprobed('operand-not-proven-local')], ['false', unprobed('operand-not-proven-local')]],
        },
        {
          site: 'a condition over a member',
          source: IN_CONDITION('o.x < 1', 'o: { x: number }'),
          mutator: 'ConditionalExpression',
          expected: [['true', unprobed('operand-not-proven-local')], ['false', unprobed('operand-not-proven-local')]],
        },
        {
          site: 'a condition over literals',
          source: IN_CONDITION('1 < 2', ''),
          mutator: 'ConditionalExpression',
          expected: [['true', probed('constant')], ['false', probed('constant')]],
        },
        {
          site: 'a conjunction',
          source: 'export const f = (a: boolean, b: boolean): boolean => a && b\n',
          mutator: 'LogicalOperator',
          expected: [['a || b', unprobed('mutator-not-probed')]],
        },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given(`a module holding ${row.site}`)('source', () => Effect.succeed(row.source)),
          When('it is instrumented with the stock mutators')('result', ({ source }: { source: string }) =>
            Instrument.instrument(
              [{ name: '/tmp/probe-eligibility.ts', content: source, mutate: true }],
              stockOptions({ ignorers: [], excludedMutations: [] }),
            )),
          Then(`each ${row.mutator} mutant carries the probe eligibility its operands prove`)((
            { result }: { result: Instrument.InstrumentResult },
            expect,
          ) =>
            expect(
              result.mutants
                .filter((mutant) =>
                  mutant.mutatorName === row.mutator
                )
                .map((mutant) => [mutant.replacement, mutant.probeEligibility]),
            ).toEqual(row.expected)
          ),
        ),
    )
  })
