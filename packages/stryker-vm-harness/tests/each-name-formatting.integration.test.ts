import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Registry } from '@systemfsoftware/stryker-vm-harness'
import { Effect, Layer } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

Feature('Formatting each-runner test names')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'An integer placeholder rounds its value down to a whole number',
      Gherkin.Do.pipe(
        Given('the template "value: %i" paired with the row 42.7')(
          'input',
          () => Effect.succeed({ template: 'value: %i', row: [42.7] }),
        ),
        When('the name is formatted')(
          'name',
          (s) => Effect.sync(() => Registry.formatEachName(s.input.template, s.input.row)),
        ),
        Then('the name reads "value: 42"')((s) =>
          Effect.sync(() => {
            expect(s.name).toBe('value: 42')
          })
        ),
      ),
    )

    scenario(
      'Number and float placeholders format their values numerically',
      Gherkin.Do.pipe(
        Given('the whole-number and decimal templates with their rows')(
          'cases',
          () =>
            Effect.succeed([
              { template: 'num: %d', row: [123] },
              { template: 'num: %d', row: ['123.450'] },
              { template: 'num: %d', row: ['not-a-number'] },
              { template: 'float: %f', row: [3.14159] },
              { template: 'float: %f', row: ['3.140'] },
            ]),
        ),
        When('each template is formatted')(
          'names',
          (s) => Effect.sync(() => s.cases.map((entry) => Registry.formatEachName(entry.template, entry.row))),
        ),
        Then('the values read 123, 123.45, NaN, 3.14159, and 3.14')((s) =>
          Effect.sync(() => {
            expect(s.names).toStrictEqual([
              'num: 123',
              'num: 123.45',
              'num: NaN',
              'float: 3.14159',
              'float: 3.14',
            ])
          })
        ),
      ),
    )

    scenario(
      'A JSON placeholder renders its value as JSON',
      Gherkin.Do.pipe(
        Given('the object, null, and string rows for the JSON template')(
          'cases',
          () =>
            Effect.succeed([
              { template: 'obj: %j', row: [{ a: 1 }] },
              { template: 'null: %j', row: [null] },
              { template: 'str: %j', row: ['plain'] },
            ]),
        ),
        When('each template is formatted')(
          'names',
          (s) => Effect.sync(() => s.cases.map((entry) => Registry.formatEachName(entry.template, entry.row))),
        ),
        Then('the names read as a JSON object, a JSON null, and a JSON string')((s) =>
          Effect.sync(() => {
            expect(s.names).toStrictEqual(['obj: {"a":1}', 'null: null', 'str: "plain"'])
          })
        ),
      ),
    )

    scenario(
      'An unmatched placeholder token is left exactly as written',
      Gherkin.Do.pipe(
        Given('the template "val: %D %F %s" with a single row entry')(
          'input',
          () => Effect.succeed({ template: 'val: %D %F %s', row: ['a'] }),
        ),
        When('the name is formatted')(
          'name',
          (s) => Effect.sync(() => Registry.formatEachName(s.input.template, s.input.row)),
        ),
        Then('only the recognized token consumes the row and the rest stay literal')((s) =>
          Effect.sync(() => {
            expect(s.name).toBe('val: %D %F a')
          })
        ),
      ),
    )

    scenario(
      'The index placeholder reports the row position',
      Gherkin.Do.pipe(
        Given('the template "case %#" with a single row entry')(
          'input',
          () => Effect.succeed({ template: 'case %#', row: ['a'] }),
        ),
        When('the name is formatted')(
          'name',
          (s) => Effect.sync(() => Registry.formatEachName(s.input.template, s.input.row)),
        ),
        Then('the name reads "case 1"')((s) =>
          Effect.sync(() => {
            expect(s.name).toBe('case 1')
          })
        ),
      ),
    )

    scenario(
      'A doubled percent sign renders as a single percent sign',
      Gherkin.Do.pipe(
        Given('the template "100%% %s" with the row "done"')(
          'input',
          () => Effect.succeed({ template: '100%% %s', row: ['done'] }),
        ),
        When('the name is formatted')(
          'name',
          (s) => Effect.sync(() => Registry.formatEachName(s.input.template, s.input.row)),
        ),
        Then('the name reads "100% done"')((s) =>
          Effect.sync(() => {
            expect(s.name).toBe('100% done')
          })
        ),
      ),
    )

    scenario(
      'Dollar placeholders substitute values from the row',
      Gherkin.Do.pipe(
        Given('the template "$foo and ${bar}" with a row carrying foo as hello and bar as world')(
          'input',
          () => Effect.succeed({ template: '$foo and ${bar}', row: { foo: 'hello', bar: 'world' } }),
        ),
        When('the name is formatted')(
          'name',
          (s) => Effect.sync(() => Registry.formatEachName(s.input.template, s.input.row)),
        ),
        Then('the name reads "hello and world"')((s) =>
          Effect.sync(() => {
            expect(s.name).toBe('hello and world')
          })
        ),
      ),
    )

    scenario(
      'Null and undefined values render as their text forms',
      Gherkin.Do.pipe(
        Given('the text and JSON templates with null and undefined rows')(
          'cases',
          () =>
            Effect.succeed([
              { template: 'val: %s', row: [null] },
              { template: 'val: %s', row: [undefined] },
              { template: 'val: %j', row: [null] },
            ]),
        ),
        When('each template is formatted')(
          'names',
          (s) => Effect.sync(() => s.cases.map((entry) => Registry.formatEachName(entry.template, entry.row))),
        ),
        Then('the names read null and undefined in both text and JSON form')((s) =>
          Effect.sync(() => {
            expect(s.names).toStrictEqual(['val: null', 'val: undefined', 'val: null'])
          })
        ),
      ),
    )

    scenario(
      'An object value renders as JSON under the default placeholder',
      Gherkin.Do.pipe(
        Given('the template "val: %s" with the object row carrying x as 2')(
          'input',
          () => Effect.succeed({ template: 'val: %s', row: [{ x: 2 }] }),
        ),
        When('the name is formatted')(
          'name',
          (s) => Effect.sync(() => Registry.formatEachName(s.input.template, s.input.row)),
        ),
        Then('the name reads "val: {"x":2}"')((s) =>
          Effect.sync(() => {
            expect(s.name).toBe('val: {"x":2}')
          })
        ),
      ),
    )

    scenario(
      'A single non-array value is formatted as one entry',
      Gherkin.Do.pipe(
        Given('the template "val: %s" with the bare row "single"')(
          'input',
          () => Effect.succeed({ template: 'val: %s', row: 'single' }),
        ),
        When('the name is formatted')(
          'name',
          (s) => Effect.sync(() => Registry.formatEachName(s.input.template, s.input.row)),
        ),
        Then('the name reads "val: single"')((s) =>
          Effect.sync(() => {
            expect(s.name).toBe('val: single')
          })
        ),
      ),
    )

    scenario(
      'A missing property renders as an empty string',
      Gherkin.Do.pipe(
        Given('the template "$missing" with a row that lacks that property')(
          'input',
          () => Effect.succeed({ template: '$missing', row: {} }),
        ),
        When('the name is formatted')(
          'name',
          (s) => Effect.sync(() => Registry.formatEachName(s.input.template, s.input.row)),
        ),
        Then('the name is empty')((s) =>
          Effect.sync(() => {
            expect(s.name).toBe('')
          })
        ),
      ),
    )
  })
