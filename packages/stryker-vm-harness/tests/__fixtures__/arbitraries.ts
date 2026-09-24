import * as fc from 'fast-check'

import type {
  DrainFileSpec,
  DrainSeedSpec,
  DrainTestSpec,
  EachNameSpec,
  PlanModeSpec,
  PlanSeedSpec,
  PlanTestSpec,
} from './differential-oracle.js'

type EachValue = null | undefined | string | number | boolean | bigint | symbol | object

const literalText: fc.Arbitrary<string> = fc.stringMatching(/[a-z ]{0,5}/u)

const tokenText: fc.Arbitrary<string> = fc.constantFrom(
  '%s',
  '%d',
  '%i',
  '%f',
  '%j',
  '%o',
  '%O',
  '%c',
  '%#',
  '%$',
  '%%',
)

const interpolationText: fc.Arbitrary<string> = fc.constantFrom(
  '$alpha',
  '$beta',
  '$alpha.gamma',
  '$missing',
  '$0',
  '$1',
  '${alpha}',
  '${beta}',
)

const templateArbitrary: fc.Arbitrary<string> = fc
  .array(fc.oneof(literalText, tokenText, interpolationText), { minLength: 1, maxLength: 4 })
  .map((pieces) => pieces.join(''))

export const consumableTokenCount = (template: string): number => (template.match(/%[sdjifoOc]/gu) ?? []).length

const scalarArbitrary: fc.Arbitrary<EachValue> = fc.oneof(
  fc.constantFrom('x', 'yy', 'word'),
  fc.integer({ min: -999, max: 9999 }),
  fc.constantFrom(true, false),
  fc.constantFrom(1n, 10n, 999n),
  fc.constantFrom(-0, 3.5, Number.NaN, Number.POSITIVE_INFINITY),
  fc.constantFrom(null, undefined),
  fc.constantFrom<EachValue>([1, 2], ['a', 'b']),
)

const objectRowArbitrary: fc.Arbitrary<ReadonlyArray<EachValue>> = fc.oneof(
  fc
    .record({ alpha: scalarArbitrary, beta: scalarArbitrary })
    .map((row): ReadonlyArray<EachValue> => [row]),
  fc
    .record({ alpha: fc.record({ gamma: scalarArbitrary }), beta: scalarArbitrary })
    .map((row): ReadonlyArray<EachValue> => [row]),
)

const rowsFor = (consumables: number): fc.Arbitrary<ReadonlyArray<EachValue>> =>
  consumables === 0
    ? objectRowArbitrary
    : fc.oneof(
      objectRowArbitrary,
      fc
        .array(scalarArbitrary, { minLength: consumables, maxLength: consumables })
        .map((row): ReadonlyArray<EachValue> => row),
    )

export const eachNameSpecs: fc.Arbitrary<EachNameSpec> = templateArbitrary.chain((template) =>
  rowsFor(consumableTokenCount(template)).map((row): EachNameSpec => ({ template, row }))
)

const planModeArbitrary: fc.Arbitrary<PlanModeSpec> = fc.constantFrom('run', 'skip', 'only', 'todo', 'fails')

const planTestSpecs: fc.Arbitrary<PlanTestSpec> = fc.record({
  mode: planModeArbitrary,
  name: fc.constantFrom('alpha', 'beta', 'gamma'),
  suiteSize: fc.nat({ max: 1 }),
})

export const planSeeds: fc.Arbitrary<PlanSeedSpec> = fc
  .array(planTestSpecs, { minLength: 1, maxLength: 4 })
  .map((tests): PlanSeedSpec => ({ tests, prepared: false }))

const drainModeArbitrary: fc.Arbitrary<DrainTestSpec['mode']> = fc.constantFrom('run', 'skip', 'todo', 'fails')

const drainFileSpecs: fc.Arbitrary<DrainFileSpec> = fc
  .array(
    fc.record({ mode: drainModeArbitrary, name: fc.constantFrom('t1', 't2', 't3') }),
    { minLength: 1, maxLength: 3 },
  )
  .map(
    (tests): DrainFileSpec => ({
      name: '',
      tests: tests.map((spec, index) => ({ mode: spec.mode, name: `${spec.name}-${index}` })),
    }),
  )

export const drainSeeds: fc.Arbitrary<DrainSeedSpec> = fc
  .array(drainFileSpecs, { minLength: 1, maxLength: 3 })
  .map(
    (files): DrainSeedSpec => ({
      files: files.map((file, index) => ({
        name: ['alpha', 'beta', 'gamma'][index] ?? `file-${index}`,
        tests: file.tests,
      })),
    }),
  )
