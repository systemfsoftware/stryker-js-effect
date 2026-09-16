import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { IncrementalReportSchema } from '@systemfsoftware/stryker-js-engine'
import { Schema as S } from 'effect'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'

const SVELTE_PLUGIN = '@systemfsoftware/stryker-js-svelte'

const MUTATED_FILE = 'src/App.svelte'
const SOURCE = '<script>let answer = 1 + 2</script>'

const RECORDED_STAMP = '0.1.0+5.55.1'

type DecodedReport = S.Schema.Type<typeof IncrementalReportSchema>

const mutatedFile = {
  language: 'svelte',
  source: SOURCE,
  mutants: [
    {
      id: '0',
      mutatorName: 'ArithmeticOperator',
      replacement: '-',
      location: { start: { line: 1, column: 13 }, end: { line: 1, column: 14 } },
      status: 'Killed',
      killedBy: ['0'],
    },
  ],
}

const reportWithOwner = (ownerVersion: string) => ({
  schemaVersion: '1.0',
  thresholds: { high: 80, low: 60 },
  files: {
    [MUTATED_FILE]: {
      ...mutatedFile,
      formatId: 'svelte',
      ownerModule: SVELTE_PLUGIN,
      ownerVersion,
    },
  },
})

const reportWithoutOwner = () => ({
  schemaVersion: '1.0',
  thresholds: { high: 80, low: 60 },
  files: { [MUTATED_FILE]: mutatedFile },
})

const read = (report: unknown) => S.decodeUnknownEffect(IncrementalReportSchema)(report).pipe(Effect.orDie)

const Feature = makeFeature({ it, layer })

Feature("Reading an earlier run's incremental report").body(({ scenario }) => {
  scenario(
    'A report that records the format owning a file keeps that owner when it is read',
    Gherkin.Do.pipe(
      Given('an incremental report recording the plugin that owns a mutated file')(
        'report',
        () => Effect.succeed(reportWithOwner(RECORDED_STAMP)),
      ),
      When('the engine reads that report')('decoded', (s: { report: unknown }) => read(s.report)),
      Then('the file carries the format that owns it and the stamp that owner recorded')((s: {
        decoded: DecodedReport
      }) => {
        expect(s.decoded.files[MUTATED_FILE]?.formatId).toBe('svelte')
        expect(s.decoded.files[MUTATED_FILE]?.ownerModule).toBe(SVELTE_PLUGIN)
        expect(s.decoded.files[MUTATED_FILE]?.ownerVersion).toBe(RECORDED_STAMP)
      }),
    ),
  )

  scenario(
    'A report written before files carried an owner is still read',
    Gherkin.Do.pipe(
      Given('an incremental report recording no owner for a mutated file')(
        'report',
        () => Effect.succeed(reportWithoutOwner()),
      ),
      When('the engine reads that report')('decoded', (s: { report: unknown }) => read(s.report)),
      Then('the file is read without an owner recorded')((s: { decoded: DecodedReport }) => {
        expect(s.decoded.files[MUTATED_FILE]?.formatId).toBeUndefined()
      }),
    ),
  )
})
