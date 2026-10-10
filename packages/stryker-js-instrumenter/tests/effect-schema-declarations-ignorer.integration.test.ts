import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { recursionBudgetTransform } from '@systemfsoftware/effect-schema-recursion-budget'
import {
  KEEP_ADVICE,
  KEEP_IGNORED_MUTANT,
  KEEP_RECURSION_BUDGET_MUTANT,
  REASON_CODES,
  type ReasonCode,
  strykerIgnorers,
} from '@systemfsoftware/stryker-ignorer-effect-schema-declarations'
import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect, Layer } from 'effect'

import { stockOptions } from './__fixtures__/instrument.js'

const FILE_NAME = '/tmp/discern.ts'

const DISCERN_SOURCE = [
  "import { Schema as S } from 'effect'",
  'declare const Expr: S.Codec<unknown>',
  'declare const eq: (left: unknown, right: unknown) => boolean',
  'export const Pattern = S.suspend(() => Expr).annotate({',
  '  recursionBudget: { maxDepth: 6, depthSize: "small" },',
  '  toEquivalence: () => (left: unknown, right: unknown) => !eq(left, right) === false,',
  '})',
].join('\n')

const BUDGET_TEXT = '{ maxDepth: 6, depthSize: "small" }'

const IGNORER_PREFIX = 'ignorer: effect-schema-declarations/'

const instrumentWithIgnorer = (source: string) =>
  Instrument.instrument(
    [{ name: FILE_NAME, content: source, mutate: true }],
    stockOptions({ ignorers: [...strykerIgnorers], excludedMutations: [] }),
  )

const BUDGET_START = DISCERN_SOURCE.indexOf(BUDGET_TEXT)
const BUDGET_END = BUDGET_START + BUDGET_TEXT.length
const OBJECT_START = DISCERN_SOURCE.indexOf('.annotate({') + '.annotate('.length
const OBJECT_END = DISCERN_SOURCE.lastIndexOf('}') + 1

const lineStarts = DISCERN_SOURCE.split('\n').reduce<readonly number[]>(
  (starts, line) => [...starts, (starts.at(-1) ?? 0) + line.length + 1],
  [0],
)

const offsetOf = (position: { readonly line: number; readonly column: number }) =>
  (lineStarts[position.line - 1] ?? Number.NaN) + position.column - 1

type InstrumentedMutant = Instrument.InstrumentResult['mutants'][number]

const spanOf = (mutant: InstrumentedMutant) => ({
  start: offsetOf(mutant.location.start),
  end: offsetOf(mutant.location.end),
})

const isInsideBudget = (mutant: InstrumentedMutant) => {
  const span = spanOf(mutant)
  return span.start >= BUDGET_START && span.end <= BUDGET_END
}

const isWholeObject = (mutant: InstrumentedMutant) => {
  const span = spanOf(mutant)
  return span.start === OBJECT_START && span.end === OBJECT_END
}

const isReasonCode = (code: string | undefined): code is ReasonCode =>
  code !== undefined && Object.hasOwn(REASON_CODES, code)

const codeOf = (mutant: InstrumentedMutant): ReasonCode | undefined => {
  const reason = mutant.statusReason ?? ''
  const code = reason.startsWith(IGNORER_PREFIX) ? reason.slice(IGNORER_PREFIX.length).split(':')[0] : undefined
  return isReasonCode(code) ? code : undefined
}

const fullReasonOf = (code: ReasonCode) => `${IGNORER_PREFIX}${code}: ${REASON_CODES[code]}`

const transformed = (result: Instrument.InstrumentResult) => {
  const instrumented = result.files.find((file) => file.name === FILE_NAME)?.content ?? ''
  const output = recursionBudgetTransform().transform(instrumented, FILE_NAME)
  return typeof output === 'string' ? output : ''
}

const Feature = makeFeature({ it })

Feature('Skipping recursion-budget metadata in Effect Schema declarations')
  .live('instruments real source through the published ignorer and the published recursion-budget transform')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A recursion budget beside an equivalence hook still reaches the transform while the hook is tested',
      Gherkin.Do.pipe(
        Given('a recursive schema annotated with a recursion budget and an equivalence hook')(
          'source',
          () => Effect.succeed(DISCERN_SOURCE),
        ),
        When('it is instrumented with the schema-declarations ignorer')(
          'result',
          ({ source }: { source: string }) => instrumentWithIgnorer(source),
        ),
        Then(
          'the budget and its object are skipped with their reasons, the hook is tested, and the budget is injected',
        )((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) =>
          expect({
            budget: result.mutants.filter(isInsideBudget).map((mutant) => [mutant.status, mutant.statusReason]),
            object: result.mutants.filter(isWholeObject).map((mutant) => [mutant.status, mutant.statusReason]),
            hookLive: result.mutants.some((mutant) =>
              !isInsideBudget(mutant) && !isWholeObject(mutant) && mutant.status !== 'Ignored'
            ),
            injected: transformed(result).includes(
              `toCodecArbitrary: __esRecursionBudget(() => Pattern, ${BUDGET_TEXT})`,
            ),
          }).toEqual({
            budget: [
              ['Ignored', fullReasonOf('recursion-budget')],
              ['Ignored', fullReasonOf('recursion-budget')],
            ],
            object: [['Ignored', fullReasonOf('recursion-budget-holder')]],
            hookLive: true,
            injected: true,
          })
        ),
      ),
    )

    scenario(
      'Each ignored mutant carries the keep advice of its own reason code',
      Gherkin.Do.pipe(
        Given('the same recursive schema beside a branded identity')(
          'source',
          () => Effect.succeed(`${DISCERN_SOURCE}\nexport const PatternBrand = Symbol.for('discern/Pattern')`),
        ),
        When('it is instrumented with the schema-declarations ignorer')(
          'result',
          ({ source }: { source: string }) => instrumentWithIgnorer(source),
        ),
        Then('budget reasons advise removing the budget and the brand reason advises removing the ignorer')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) => {
          const advice = Object.fromEntries(
            result.mutants.flatMap((mutant) => {
              const code = codeOf(mutant)
              return code === undefined ? [] : [[code, KEEP_ADVICE[code]]]
            }),
          )
          return expect(advice).toEqual({
            'recursion-budget': KEEP_RECURSION_BUDGET_MUTANT,
            'recursion-budget-holder': KEEP_RECURSION_BUDGET_MUTANT,
            'symbol-description': KEEP_IGNORED_MUTANT,
          })
        }),
      ),
    )
  })
