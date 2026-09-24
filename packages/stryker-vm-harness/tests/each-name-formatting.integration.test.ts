import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Registry } from '@systemfsoftware/stryker-vm-harness'
import { Effect, Layer } from 'effect'
import { expect } from 'vitest'

const TITLES_VITEST_GIVES = [
  { pattern: '%s', tableRow: ['plain'], expected: 'plain' },
  { pattern: '%s', tableRow: [123], expected: '123' },
  { pattern: '%s', tableRow: [-0], expected: '-0' },
  { pattern: '%s', tableRow: [Number.NaN], expected: 'NaN' },
  { pattern: '%s', tableRow: [Number.POSITIVE_INFINITY], expected: 'Infinity' },
  { pattern: '%s', tableRow: [null], expected: 'null' },
  { pattern: '%s', tableRow: [undefined], expected: 'undefined' },
  { pattern: '%s', tableRow: [Symbol('sym')], expected: 'Symbol(sym)' },
  { pattern: '%s', tableRow: [{ b: 1 }], expected: '{ b: 1 }' },
  { pattern: '%s', tableRow: [{ a: { n: 1 }, b: 2 }], expected: '{ a: { n: 1 }, b: 2 }' },
  { pattern: '%s', tableRow: [[1, 2]], expected: '1,2' },
  { pattern: '%s', tableRow: [{ toString: () => 'custom!' }], expected: 'custom!' },
  {
    pattern: '%s',
    tableRow: [{ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }],
    expected: '{ …(1) }',
  },
  { pattern: '%d', tableRow: [123], expected: '123' },
  { pattern: '%d', tableRow: ['123.450'], expected: '123.45' },
  { pattern: '%d', tableRow: ['not-a-number'], expected: 'NaN' },
  { pattern: '%d', tableRow: [true], expected: '1' },
  { pattern: '%d', tableRow: [Symbol('s')], expected: 'NaN' },
  { pattern: '%d', tableRow: [{ b: 1 }], expected: 'NaN' },
  { pattern: '%i', tableRow: [42.7], expected: '42' },
  { pattern: '%i', tableRow: [[1, 2]], expected: '1' },
  { pattern: '%i', tableRow: ['abc'], expected: 'NaN' },
  { pattern: '%f', tableRow: [3.14159], expected: '3.14159' },
  { pattern: '%f', tableRow: ['3.140'], expected: '3.14' },
  { pattern: '%f', tableRow: [-0], expected: '-0' },
  { pattern: '%f', tableRow: [Number.NaN], expected: 'NaN' },
  { pattern: '%j', tableRow: [{ a: 1 }], expected: '{"a":1}' },
  { pattern: '%j', tableRow: [null], expected: 'null' },
  { pattern: '%j', tableRow: ['plain'], expected: '"plain"' },
  { pattern: '%j', tableRow: [undefined], expected: 'undefined' },
  { pattern: '%o', tableRow: [{ b: 1 }], expected: '{ b: 1 }' },
  { pattern: '%o', tableRow: [{ a: { n: 1 }, b: 2 }], expected: '{ a: { n: 1 }, b: 2 }' },
  { pattern: '%o', tableRow: [{ a: 1, b: 2, c: 3, d: 4, e: 5 }], expected: '{ a: 1, b: 2, c: 3, d: 4, e: 5 }' },
  { pattern: '%o', tableRow: ['text'], expected: "'text'" },
  { pattern: '%O', tableRow: [[1, 2]], expected: '[ 1, 2 ]' },
  { pattern: '%c!', tableRow: ['x'], expected: '!' },
  { pattern: '%# / %$', tableRow: ['a'], expected: '0 / 1' },
  { pattern: '%%', tableRow: ['a'], expected: '% a' },
  { pattern: '%% then %s', tableRow: ['a', 'b'], expected: '% a then b' },
  { pattern: '100%% %s', tableRow: ['done'], expected: '100% done undefined' },
  { pattern: '$foo and ${bar}', tableRow: { foo: 'hello', bar: 'world' }, expected: 'hello and ${bar}' },
  { pattern: '$missing', tableRow: {}, expected: 'undefined' },
  { pattern: '$0 $1', tableRow: ['x', 'y'], expected: 'x y' },
  { pattern: '$foo', tableRow: ['x'], expected: '$foo' },
  {
    pattern: '$long',
    tableRow: { long: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNO' },
    expected: 'abcdefghijklmnopqrstuvwxyz0123456789ABC…',
  },
  { pattern: '%s %s', tableRow: ['a'], expected: 'a undefined' },
  { pattern: '%D %F %s', tableRow: ['a'], expected: '%D %F a' },
  { pattern: '%s', tableRow: { b: 1 }, expected: '{ b: 1 }' },
  { pattern: '${bar}', tableRow: { bar: 'world' }, expected: '${bar}' },
  { pattern: '%s', tableRow: 'single', expected: 'single' },
  { pattern: '%s %s', tableRow: ['a', 'b'], expected: 'a b' },
  { pattern: '%s %s Tail', tableRow: ['b', 'a'], expected: 'b a Tail' },
  { pattern: '%d then %s', tableRow: [3.5, 'yy'], expected: '3.5 then yy' },
]

const Feature = makeFeature({ it, layer })

Feature('Naming each-runner tests from a table row exactly as Vitest does')
  .withLayer(Layer.empty)
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'A table row turns the title <pattern> into the name <expected>',
      TITLES_VITEST_GIVES,
      (row) =>
        Gherkin.Do.pipe(
          Given('a suite registers one test per row of a table')(
            'input',
            () => Effect.succeed({ pattern: row.pattern, tableRow: row.tableRow }),
          ),
          When("the suite composes that test's name from the row")(
            'composed',
            (s) => Effect.sync(() => Registry.formatEachName(s.input.pattern, s.input.tableRow)),
          ),
          Then('the name is the one Vitest gives the same row')((s) =>
            Effect.sync(() => {
              expect(s.composed).toBe(row.expected)
            })
          ),
        ),
    )

    scenario(
      'The row counter advances from one row of the table to the next',
      Gherkin.Do.pipe(
        Given('a table of two rows whose title counts them')(
          'table',
          () => Effect.succeed({ pattern: 'row %# / %$ / %s', rows: [['x'], ['y']] as const }),
        ),
        When('each row is named in table order')(
          'names',
          (s) =>
            Effect.sync(() =>
              s.table.rows.map((row, index) => Registry.formatEachName(s.table.pattern, row, { index }))
            ),
        ),
        Then('the first row counts as the first and the second as the second')((s) =>
          Effect.sync(() => {
            expect(s.names).toStrictEqual(['row 0 / 1 / x', 'row 1 / 2 / y'])
          })
        ),
      ),
    )

    scenario(
      'A row no string form can name fails the title the way Vitest fails it',
      Gherkin.Do.pipe(
        Given('a table whose only value has no usable string form')(
          'input',
          () => Effect.succeed({ pattern: '%i', tableRow: [Object.create(null)] }),
        ),
        When("the suite tries to compose that test's name")(
          'composed',
          (s) => Effect.succeed({ input: s.input }),
        ),
        Then('the title fails exactly as it does under Vitest')((s) =>
          Effect.sync(() => {
            expect(() => Registry.formatEachName(s.composed.input.pattern, s.composed.input.tableRow)).toThrow(
              'Cannot convert object to primitive value',
            )
          })
        ),
      ),
    )
  })
