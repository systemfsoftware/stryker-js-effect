import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

type ReportProbe = { readonly [key: string]: S.Json }

const sampleMutant = (): ReportProbe => ({
  id: '0000000000000001',
  mutatorName: 'ArithmeticOperator',
  status: 'Killed',
  location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
})

const sampleFile = (): ReportProbe => ({
  language: 'typescript',
  source: 'const a = 1',
  mutants: [sampleMutant()],
})

const sampleReport = (): ReportProbe => ({
  schemaVersion: '1.1',
  thresholds: { high: 80, low: 60, break: 70 },
  files: { 'src/order.ts': sampleFile() },
  performance: { setup: 1, initialRun: 2, mutation: 3 },
  system: { ci: true, os: { platform: 'linux' } },
})

const withoutKey = (record: ReportProbe, key: string): ReportProbe => {
  const { [key]: _dropped, ...rest } = record
  return rest
}

const reportWith = (fields: ReportProbe): ReportProbe => ({ ...sampleReport(), ...fields })

const reportWithVersion = (schemaVersion: string): ReportProbe => reportWith({ schemaVersion })

const reportWithThresholds = (thresholds: ReportProbe): ReportProbe => reportWith({ thresholds })

const reportWithHighThreshold = (high: number): ReportProbe => reportWithThresholds({ high, low: 60 })

const reportWithBreakThreshold = (breaking: null | number): ReportProbe =>
  reportWithThresholds({ high: 80, low: 60, break: breaking })

const reportWithMutant = (mutant: ReportProbe): ReportProbe =>
  reportWith({ files: { 'src/order.ts': { ...sampleFile(), mutants: [mutant] } } })

const reportWithStatus = (status: string): ReportProbe => reportWithMutant({ ...sampleMutant(), status })

const reportWithLine = (line: number): ReportProbe =>
  reportWithMutant({ ...sampleMutant(), location: { start: { line, column: 1 }, end: { line, column: 2 } } })

const reportWithoutThresholds = (): ReportProbe => withoutKey(sampleReport(), 'thresholds')

const reportWithoutMutantKey = (key: string): ReportProbe => reportWithMutant(withoutKey(sampleMutant(), key))

const reportOutcome = (document: S.Json): string => {
  const decoded = S.decodeUnknownResult(Report.MutationTestResult, { reportInput: true })(document)
  return Result.isSuccess(decoded) ? 'accepted' : `refused: ${decoded.failure.message}`
}

const decodedOutcomes = (documents: Record<string, S.Json>): Record<string, string> => {
  const outcomes: Record<string, string> = {}
  for (const [name, document] of Object.entries(documents)) outcomes[name] = reportOutcome(document)
  return outcomes
}

Feature('The report codec decodes what the upstream report schema declares')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A report naming the pinned upstream version is accepted and another major is refused by name',
      Gherkin.Do.pipe(
        Given('reports naming the unknown major 3 and the pinned minor 1.1')(
          'probes',
          () =>
            Effect.sync(() => ({
              unknownMajor: reportWithVersion('3'),
              pinnedMinor: reportWithVersion('1.1'),
            })),
        ),
        When('each report is decoded through the report codec')(
          'outcomes',
          (s) => Effect.sync(() => decodedOutcomes(s.probes)),
        ),
        Then('the unknown major is refused with its version named and the pinned minor is accepted')((s, expect) =>
          expect(s.outcomes).toEqual({
            unknownMajor: expect.stringMatching(/^refused:[\s\S]*3/),
            pinnedMinor: 'accepted',
          })
        ),
      ),
    )

    scenario(
      'A mutant status from the shared vocabulary is accepted and another status is refused by name',
      Gherkin.Do.pipe(
        Given('mutants carrying the declared status Killed and the undeclared NotAStatus')(
          'probes',
          () =>
            Effect.sync(() => ({
              declared: reportWithStatus('Killed'),
              undeclared: reportWithStatus('NotAStatus'),
            })),
        ),
        When('each report is decoded through the report codec')(
          'outcomes',
          (s) => Effect.sync(() => decodedOutcomes(s.probes)),
        ),
        Then('the undeclared status is refused with it named and the declared status is accepted')((s, expect) =>
          expect(s.outcomes).toEqual({
            declared: 'accepted',
            undeclared: expect.stringMatching(/^refused:[\s\S]*NotAStatus/),
          })
        ),
      ),
    )

    scenario(
      'A threshold on the report is an integer percentage, so a fractional or out-of-range bound is refused',
      Gherkin.Do.pipe(
        Given('reports whose high threshold is fractional, above the range and inside it')(
          'probes',
          () =>
            Effect.sync(() => ({
              fractional: reportWithHighThreshold(80.5),
              above: reportWithHighThreshold(101),
              inRange: reportWithHighThreshold(80),
            })),
        ),
        When('each report is decoded through the report codec')(
          'outcomes',
          (s) => Effect.sync(() => decodedOutcomes(s.probes)),
        ),
        Then('only the integer percentage inside the range is accepted')((s, expect) =>
          expect(s.outcomes).toEqual({
            fractional: expect.stringMatching(/^refused:/),
            above: expect.stringMatching(/^refused:/),
            inRange: 'accepted',
          })
        ),
      ),
    )

    scenario(
      'A break threshold is a percentage or null, so an out-of-range break is refused',
      Gherkin.Do.pipe(
        Given('reports breaking above the range, on a fraction and on null')(
          'probes',
          () =>
            Effect.sync(() => ({
              above: reportWithBreakThreshold(101),
              fraction: reportWithBreakThreshold(80.5),
              disabled: reportWithBreakThreshold(null),
            })),
        ),
        When('each report is decoded through the report codec')(
          'outcomes',
          (s) => Effect.sync(() => decodedOutcomes(s.probes)),
        ),
        Then('the out-of-range break is refused while a fraction and null are accepted')((s, expect) =>
          expect(s.outcomes).toEqual({
            above: expect.stringMatching(/^refused:/),
            fraction: 'accepted',
            disabled: 'accepted',
          })
        ),
      ),
    )

    scenario(
      'A mutant position is one-based, so a line before the first line is refused',
      Gherkin.Do.pipe(
        Given('reports whose mutant sits on line 0 and on line 1')(
          'probes',
          () =>
            Effect.sync(() => ({
              beforeFirst: reportWithLine(0),
              first: reportWithLine(1),
            })),
        ),
        When('each report is decoded through the report codec')(
          'outcomes',
          (s) => Effect.sync(() => decodedOutcomes(s.probes)),
        ),
        Then('the line before the first line is refused and the first line is accepted')((s, expect) =>
          expect(s.outcomes).toEqual({ beforeFirst: expect.stringMatching(/^refused:/), first: 'accepted' })
        ),
      ),
    )

    scenario(
      'A report that omits its thresholds is refused',
      Gherkin.Do.pipe(
        Given('a report carrying thresholds and one that omits them')(
          'probes',
          () =>
            Effect.sync(() => ({
              present: sampleReport(),
              absent: reportWithoutThresholds(),
            })),
        ),
        When('each report is decoded through the report codec')(
          'outcomes',
          (s) => Effect.sync(() => decodedOutcomes(s.probes)),
        ),
        Then('the report carrying thresholds is accepted and the one omitting them is refused')((s, expect) =>
          expect(s.outcomes).toEqual({ present: 'accepted', absent: expect.stringMatching(/^refused:/) })
        ),
      ),
    )

    scenario(
      'A mutant that omits its location is refused',
      Gherkin.Do.pipe(
        Given('a report whose mutant carries a location and one whose mutant omits it')(
          'probes',
          () =>
            Effect.sync(() => ({
              present: sampleReport(),
              absent: reportWithoutMutantKey('location'),
            })),
        ),
        When('each report is decoded through the report codec')(
          'outcomes',
          (s) => Effect.sync(() => decodedOutcomes(s.probes)),
        ),
        Then('the mutant carrying a location is accepted and the one omitting it is refused')((s, expect) =>
          expect(s.outcomes).toEqual({ present: 'accepted', absent: expect.stringMatching(/^refused:/) })
        ),
      ),
    )

    scenario(
      'A mutant that omits its status is refused',
      Gherkin.Do.pipe(
        Given('a report whose mutant carries a status and one whose mutant omits it')(
          'probes',
          () =>
            Effect.sync(() => ({
              present: sampleReport(),
              absent: reportWithoutMutantKey('status'),
            })),
        ),
        When('each report is decoded through the report codec')(
          'outcomes',
          (s) => Effect.sync(() => decodedOutcomes(s.probes)),
        ),
        Then('the mutant carrying a status is accepted and the one omitting it is refused')((s, expect) =>
          expect(s.outcomes).toEqual({ present: 'accepted', absent: expect.stringMatching(/^refused:/) })
        ),
      ),
    )
  })
