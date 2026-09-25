import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { Judge, TestContribution } from '@systemfsoftware/stryker-test-contribution'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Result from 'effect/Result'

import { optionalRunnerFields } from './__fixtures__/optional-runner-fields.js'

const Feature = makeFeature({ it })

const LOCATION = { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } }

const mutantOf = (
  id: string,
  status: Mutant.MutantStatus,
  killedBy?: string[],
  coveredBy?: string[],
): Report.MutantResult => ({
  id,
  status,
  mutatorName: 'BooleanLiteral',
  location: LOCATION,
  ...optionalRunnerFields(killedBy, coveredBy),
})

const reportOf = (
  mutants: Report.MutantResult[],
  testFiles: Record<string, string[]>,
): Pick<Report.MutationTestResult, 'files' | 'testFiles'> => ({
  files: {
    'src/subject.ts': { language: 'typescript', source: 'export const a = 1\n', mutants },
  },
  testFiles: Object.fromEntries(
    Object.entries(testFiles).map(([fileName, testIds]) => [
      fileName,
      { tests: testIds.map((id) => ({ id, name: `test ${id}` })) },
    ]),
  ),
})

const PROPERTY = ['.property.test.ts']
const EXACT = { suffixes: PROPERTY, everyKillerRecorded: true }
const BAILED = { suffixes: PROPERTY, everyKillerRecorded: false }

const commandOf = (
  report: TestContribution.ReportView,
  suffixes: readonly string[],
  everyKillerRecorded: boolean,
): Judge.JudgeTestContribution =>
  Judge.JudgeTestContribution.make({
    report: {
      schemaVersion: '2',
      files: report.files,
      thresholds: { high: 80, low: 60 },
      ...(report.testFiles === undefined ? {} : { testFiles: report.testFiles }),
    },
    suffixes,
    everyKillerRecorded,
  })

const judgedWith = (
  report: TestContribution.ReportView,
  input: { readonly suffixes: readonly string[]; readonly everyKillerRecorded: boolean },
): Judge.TestContributionDecision =>
  Judge.judgeTestContribution(
    commandOf(report, input.suffixes, input.everyKillerRecorded),
  ).pipe(Result.merge)

const contributionByTestFile = (report: TestContribution.ReportView) => new Map(judgedWith(report, EXACT).contribution)

const defaultSuffixes: readonly string[] = Judge.JudgeTestContribution.defaultRequireTestContributionSuffixes
const earnsAndIdleReport = (): Pick<Report.MutationTestResult, 'files' | 'testFiles'> =>
  reportOf(
    [
      mutantOf('m1', 'Killed', ['t1', 't2'], ['t1', 't2']),
      mutantOf('m2', 'Killed', ['t1'], ['t1']),
    ],
    { 'earns.property.test.ts': ['t1'], 'idle.property.test.ts': ['t2'] },
  )

Feature('Judging test contribution under the test-contribution gate')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A mutant killed by one file earns sole credit for that file',
      Gherkin.Do.pipe(
        Given('a mutant killed by one file and another file covering nothing')('report', () =>
          Effect.succeed(
            reportOf([mutantOf('m1', 'Killed', ['t1'])], {
              'a.property.test.ts': ['t1'],
              'b.property.test.ts': ['t2'],
            }),
          )),
        When('contribution is computed per file')(
          'contribution',
          (s) => Effect.sync(() => Object.fromEntries(contributionByTestFile(s.report))),
        ),
        Then('the sole killer earns the sole kill and the other file earns nothing')((s, expect) =>
          expect(s.contribution).toEqual({
            'a.property.test.ts': { soleKills: 1, totalKills: 1, killableCovered: 0, coversUnattributedKill: false },
            'b.property.test.ts': { soleKills: 0, totalKills: 0, killableCovered: 0, coversUnattributedKill: false },
          })
        ),
      ),
    )

    scenario(
      'A kill shared by two files credits both files',
      Gherkin.Do.pipe(
        Given('a report killed jointly by two files')('report', () =>
          Effect.succeed(
            reportOf([mutantOf('m1', 'Killed', ['t1', 't2'])], {
              'a.property.test.ts': ['t1'],
              'b.property.test.ts': ['t2'],
            }),
          )),
        When('contribution is computed per file')(
          'contribution',
          (s) => Effect.sync(() => Object.fromEntries(contributionByTestFile(s.report))),
        ),
        Then('both files count the kill but neither claims it alone')((s, expect) =>
          expect(s.contribution).toEqual({
            'a.property.test.ts': { soleKills: 0, totalKills: 1, killableCovered: 0, coversUnattributedKill: false },
            'b.property.test.ts': { soleKills: 0, totalKills: 1, killableCovered: 0, coversUnattributedKill: false },
          })
        ),
      ),
    )

    scenario(
      'A kill whose co-killer sits outside every test file denies sole credit',
      Gherkin.Do.pipe(
        Given('a kill whose co-killer is not in any test file')('report', () =>
          Effect.succeed(
            reportOf([mutantOf('m1', 'Killed', ['t1', 'ghost'])], { 'a.property.test.ts': ['t1'] }),
          )),
        When('contribution is computed per file')(
          'contribution',
          (s) => Effect.sync(() => Object.fromEntries(contributionByTestFile(s.report))),
        ),
        Then('the placed file gets the kill but no sole credit')((s, expect) =>
          expect(s.contribution).toEqual({
            'a.property.test.ts': { soleKills: 0, totalKills: 1, killableCovered: 0, coversUnattributedKill: false },
          })
        ),
      ),
    )

    scenario(
      'A timeout that recorded its killer counts as a kill',
      Gherkin.Do.pipe(
        Given('a timeout mutant with a recorded killing test')(
          'report',
          () => Effect.succeed(reportOf([mutantOf('m1', 'Timeout', ['t1'])], { 'a.property.test.ts': ['t1'] })),
        ),
        When('contribution is computed per file')(
          'contribution',
          (s) => Effect.sync(() => Object.fromEntries(contributionByTestFile(s.report))),
        ),
        Then('the timeout counts as a sole kill')((s, expect) =>
          expect(s.contribution).toEqual({
            'a.property.test.ts': { soleKills: 1, totalKills: 1, killableCovered: 0, coversUnattributedKill: false },
          })
        ),
      ),
    )

    scenario(
      'A mutant that survived credits no file',
      Gherkin.Do.pipe(
        Given('a report with a surviving mutant')('report', () =>
          Effect.succeed(
            reportOf([mutantOf('m1', 'Survived', ['t1'])], { 'a.property.test.ts': ['t1'] }),
          )),
        When('contribution is computed per file')(
          'contribution',
          (s) => Effect.sync(() => Object.fromEntries(contributionByTestFile(s.report))),
        ),
        Then('no file earns a kill')((s, expect) =>
          expect(s.contribution).toEqual({
            'a.property.test.ts': { soleKills: 0, totalKills: 0, killableCovered: 0, coversUnattributedKill: false },
          })
        ),
      ),
    )

    scenario(
      'A killed mutant with no recorded killer credits no file',
      Gherkin.Do.pipe(
        Given('a killed mutant with no recorded killing test')(
          'report',
          () => Effect.succeed(reportOf([mutantOf('m1', 'Killed')], { 'a.property.test.ts': ['t1'] })),
        ),
        When('contribution is computed per file')(
          'contribution',
          (s) => Effect.sync(() => Object.fromEntries(contributionByTestFile(s.report))),
        ),
        Then('no file is credited for it')((s, expect) =>
          expect(s.contribution).toEqual({
            'a.property.test.ts': { soleKills: 0, totalKills: 0, killableCovered: 0, coversUnattributedKill: false },
          })
        ),
      ),
    )

    scenario(
      'A file that never kills alone is accused when killers are fully recorded',
      Gherkin.Do.pipe(
        Given(
          'a report where one file kills nothing another file does not also kill',
        )('report', () =>
          Effect.succeed(
            earnsAndIdleReport(),
          )),
        When('toothless files are computed with every killer recorded')(
          'accused',
          (s) => Effect.sync(() => judgedWith(s.report, EXACT).toothless),
        ),
        Then('the redundant file is accused')((s, expect) => expect(s.accused).toEqual(['idle.property.test.ts'])),
      ),
    )

    scenario(
      'A redundant file is spared when bail may have hidden killers',
      Gherkin.Do.pipe(
        Given(
          'a report where a file kills nothing alone, with everyKillerRecorded false',
        )('report', () =>
          Effect.succeed(
            earnsAndIdleReport(),
          )),
        When('toothless files are computed under bail')(
          'accused',
          (s) => Effect.sync(() => judgedWith(s.report, BAILED).toothless),
        ),
        Then('the redundant file is spared because a second killer may be unrecorded')((s, expect) =>
          expect(s.accused).toEqual([])
        ),
      ),
    )

    scenario(
      'A file that killed nothing is still accused even when bail is on',
      Gherkin.Do.pipe(
        Given(
          'a report with a file that killed nothing at all',
        )('report', () =>
          Effect.succeed(
            reportOf([mutantOf('m1', 'Killed', ['t1'], ['t1', 't2'])], {
              'earns.property.test.ts': ['t1'],
              'idle.property.test.ts': ['t2'],
            }),
          )),
        When('toothless files are computed under a bail')(
          'accused',
          (s) => Effect.sync(() => judgedWith(s.report, BAILED).toothless),
        ),
        Then('the kill-nothing file is still accused')((s, expect) =>
          expect(s.accused).toEqual(['idle.property.test.ts'])
        ),
      ),
    )

    scenario(
      'A file covering an unattributed kill is spared because removing it might resurrect the kill',
      Gherkin.Do.pipe(
        Given(
          'a file covering a timeout whose killing test was never named',
        )('report', () =>
          Effect.succeed(
            reportOf([mutantOf('m1', 'Killed', ['t1'], ['t1']), mutantOf('m2', 'Timeout', [], ['t2'])], {
              'earns.property.test.ts': ['t1'],
              'hangs.property.test.ts': ['t2'],
            }),
          )),
        When('toothless files are computed with every killer recorded')(
          'accused',
          (s) => Effect.sync(() => judgedWith(s.report, EXACT).toothless),
        ),
        Then('the coverer of the unattributed kill is spared')((s, expect) => expect(s.accused).toEqual([])),
      ),
    )

    scenario(
      'A file covering nothing is still accused when a sibling covers the unattributed kill',
      Gherkin.Do.pipe(
        Given(
          'a report with one coverer of an unattributed kill and one idle file',
        )('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1'], ['t1', 't3']), mutantOf('m2', 'Timeout', [], ['t2'])],
              {
                'earns.property.test.ts': ['t1'],
                'hangs.property.test.ts': ['t2'],
                'idle.property.test.ts': ['t3'],
              },
            ),
          )),
        When('toothless files are computed with every killer recorded')(
          'accused',
          (s) => Effect.sync(() => judgedWith(s.report, EXACT).toothless),
        ),
        Then('the file that covers nothing is accused')((s, expect) =>
          expect(s.accused).toEqual(['idle.property.test.ts'])
        ),
      ),
    )

    scenario(
      'A timeout with no killer list spares its covering file like an empty list',
      Gherkin.Do.pipe(
        Given(
          'a timeout mutant whose killedBy is absent rather than an empty array',
        )('report', () =>
          Effect.succeed(
            reportOf([mutantOf('m1', 'Killed', ['t1'], ['t1']), mutantOf('m2', 'Timeout', undefined, ['t2'])], {
              'earns.property.test.ts': ['t1'],
              'hangs.property.test.ts': ['t2'],
            }),
          )),
        When('toothless files are computed with every killer recorded')(
          'accused',
          (s) => Effect.sync(() => judgedWith(s.report, EXACT).toothless),
        ),
        Then('the coverer is spared the same way as with an explicit empty list')((s, expect) =>
          expect(s.accused).toEqual([])
        ),
      ),
    )

    scenario(
      'A file outside the configured suffixes is never accused',
      Gherkin.Do.pipe(
        Given('an idle file that does not match the configured suffixes')('report', () =>
          Effect.succeed(
            reportOf([mutantOf('m1', 'Killed', ['t1'], ['t1', 't2'])], {
              'earns.property.test.ts': ['t1'],
              'idle.integration.test.ts': ['t2'],
            }),
          )),
        When('toothless files are computed with every killer recorded')(
          'accused',
          (s) => Effect.sync(() => judgedWith(s.report, EXACT).toothless),
        ),
        Then('the out-of-suffix file is never accused')((s, expect) => expect(s.accused).toEqual([])),
      ),
    )

    scenario(
      'Accused files are returned sorted alphabetically',
      Gherkin.Do.pipe(
        Given('a report with several accused files out of order')('report', () =>
          Effect.succeed(
            reportOf([mutantOf('m1', 'Killed', ['t1'], ['t1', 't2', 't3'])], {
              'earns.property.test.ts': ['t1'],
              'zebra.property.test.ts': ['t2'],
              'alpha.property.test.ts': ['t3'],
            }),
          )),
        When('toothless files are computed with every configured suffix')(
          'accused',
          (s) => Effect.sync(() => judgedWith(s.report, EXACT).toothless),
        ),
        Then('they are sorted alphabetically')((s, expect) =>
          expect(s.accused).toEqual(['alpha.property.test.ts', 'zebra.property.test.ts'])
        ),
      ),
    )

    scenario(
      'A file that earns nothing fails the run and is named',
      Gherkin.Do.pipe(
        Given('a report with an earns-nothing file')('report', () =>
          Effect.succeed(
            earnsAndIdleReport(),
          )),
        When('the run is judged with exact killer recording')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: PROPERTY, everyKillerRecorded: true })),
        ),
        Then('the run fails, names the idle file, and carries no bail text')((s, expect) =>
          expect({
            failed: s.verdict.failed,
            namesIdleFile: s.verdict.message.includes('idle.property.test.ts'),
            claimsJustAsDead: s.verdict.message.includes('just as dead'),
            carriesBailText: s.verdict.message.includes('disableBail: true'),
          }).toEqual({ failed: true, namesIdleFile: true, claimsJustAsDead: true, carriesBailText: false })
        ),
      ),
    )

    scenario(
      'Every in-scope file earning its place lets the run pass',
      Gherkin.Do.pipe(
        Given('a report where every in-scope file kills a distinct mutant')('report', () =>
          Effect.succeed(
            reportOf(
              [
                mutantOf('m1', 'Killed', ['t1'], ['t1']),
                mutantOf('m2', 'Killed', ['t2'], ['t2']),
              ],
              {
                'earns.property.test.ts': ['t1'],
                'also.property.test.ts': ['t2'],
              },
            ),
          )),
        When('the verdict is judged normally')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: PROPERTY, everyKillerRecorded: true })),
        ),
        Then('the run passes')((s, expect) =>
          expect({
            failed: s.verdict.failed,
            claimsUniqueKill: s.verdict.message.includes('kills a mutant nothing else kills'),
          }).toEqual({ failed: false, claimsUniqueKill: true })
        ),
      ),
    )

    scenario(
      'Bail being on with an in-scope file needing judgement reports a configuration error',
      Gherkin.Do.pipe(
        Given('a report with an earns-nothing file under bail')('report', () =>
          Effect.succeed(
            earnsAndIdleReport(),
          )),
        When('the verdict is judged with everyKillerRecorded false')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: PROPERTY, everyKillerRecorded: false })),
        ),
        Then('the run fails citing the bail configuration')((s, expect) =>
          expect({
            failed: s.verdict.failed,
            mentionsBail: s.verdict.message.includes('bail'),
            mentionsFlag: s.verdict.message.includes('disableBail: true'),
          }).toEqual({ failed: true, mentionsBail: true, mentionsFlag: true })
        ),
      ),
    )

    scenario(
      'An out-of-scope run stays silent under bail',
      Gherkin.Do.pipe(
        Given('a report whose files carry no configured suffix')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1'], ['t1'])],
              { 'plain.test.ts': ['t1'] },
            ),
          )),
        When('the verdict is judged under bail')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: PROPERTY, everyKillerRecorded: false })),
        ),
        Then('the run stays silent')((s, expect) =>
          expect({
            failed: s.verdict.failed,
            noneJudged: s.verdict.message.includes('so none was judged'),
            mentionsFlag: s.verdict.message.includes('disableBail: true'),
          }).toEqual({ failed: false, noneJudged: true, mentionsFlag: false })
        ),
      ),
    )

    scenario(
      'No individual workflow file is singled out when bail hides possible killers',
      Gherkin.Do.pipe(
        Given('a report with only zero-kill workflow files and bail on')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1'], ['t1']), mutantOf('m2', 'Killed', ['t1'], ['t1'])],
              {
                'sole.workflow.property.test.ts': ['t1'],
                'idle.workflow.property.test.ts': ['t2'],
              },
            ),
          )),
        When('the verdict is judged with the workflow suffix')(
          'verdict',
          (s) =>
            Effect.sync(() =>
              judgedWith(s.report, { suffixes: ['.workflow.property.test.ts'], everyKillerRecorded: false })
            ),
        ),
        Then('the configuration error names the flag, not the files')((s, expect) =>
          expect({
            namesSoleFile: s.verdict.message.includes('sole.workflow.property.test.ts'),
            namesIdleFile: s.verdict.message.includes('idle.workflow.property.test.ts'),
            mentionsFlag: s.verdict.message.includes('disableBail: true'),
          }).toEqual({ namesSoleFile: false, namesIdleFile: false, mentionsFlag: true })
        ),
      ),
    )

    scenario(
      'No kill credited to any test file blames the run itself',
      Gherkin.Do.pipe(
        Given('a report with killed mutants but no credited killer')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed'), mutantOf('m2', 'Timeout')],
              { 'unjudged.property.test.ts': ['t1'] },
            ),
          )),
        When('the verdict is judged with every killer recorded')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: PROPERTY, everyKillerRecorded: true })),
        ),
        Then('the run is blamed and the files are not')((s, expect) =>
          expect({
            failed: s.verdict.failed,
            blamesRun: s.verdict.message.includes('credited no kill to any test file'),
            namesFile: s.verdict.message.includes('unjudged.property.test.ts'),
          }).toEqual({ failed: true, blamesRun: true, namesFile: false })
        ),
      ),
    )

    scenario(
      'No file matching the suffixes passes the run without judgement',
      Gherkin.Do.pipe(
        Given('a report with no in-scope test files')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1'], ['t1'])],
              { 'plain.test.ts': ['t1'] },
            ),
          )),
        When('the verdict is judged with every killer recorded')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: PROPERTY, everyKillerRecorded: true })),
        ),
        Then('the run passes and nothing was judged')((s, expect) =>
          expect({
            failed: s.verdict.failed,
            noneJudged: s.verdict.message.includes('so none was judged'),
          }).toEqual({ failed: false, noneJudged: true })
        ),
      ),
    )

    scenario(
      'A file that kills two mutants counts both kills',
      Gherkin.Do.pipe(
        Given('a report with two mutants both killed by the same file')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1']), mutantOf('m2', 'Killed', ['t1'])],
              { 'busy.property.test.ts': ['t1'] },
            ),
          )),
        When('contribution is computed per file')(
          'contribution',
          (s) => Effect.sync(() => Object.fromEntries(contributionByTestFile(s.report))),
        ),
        Then('both kills are counted for the file')((s, expect) =>
          expect(s.contribution).toEqual({
            'busy.property.test.ts': { soleKills: 2, totalKills: 2, killableCovered: 0, coversUnattributedKill: false },
          })
        ),
      ),
    )

    scenario(
      'A file matching any of several suffixes is judged in scope',
      Gherkin.Do.pipe(
        Given('a report with one file matching only one of several suffixes')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1'], ['t1', 't2'])],
              {
                'earns.property.test.ts': ['t1'],
                'idle.law.test.ts': ['t2'],
              },
            ),
          )),
        When('the verdict is judged against both suffixes')(
          'verdict',
          (s) =>
            Effect.sync(() =>
              judgedWith(s.report, { suffixes: ['.property.test.ts', '.law.test.ts'], everyKillerRecorded: true })
            ),
        ),
        Then('the matching file is judged in scope')((s, expect) =>
          expect({
            failed: s.verdict.failed,
            namesIdleLaw: s.verdict.message.includes('idle.law.test.ts'),
          }).toEqual({ failed: true, namesIdleLaw: true })
        ),
      ),
    )

    scenario(
      'No file matching any suffix names every configured suffix',
      Gherkin.Do.pipe(
        Given('a report with no file matching any configured suffix')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1'], ['t1'])],
              { 'plain.test.ts': ['t1'] },
            ),
          )),
        When('the verdict is judged against both suffixes')(
          'verdict',
          (s) =>
            Effect.sync(() =>
              judgedWith(s.report, { suffixes: ['.property.test.ts', '.law.test.ts'], everyKillerRecorded: true })
            ),
        ),
        Then('the message names both suffixes')((s, expect) =>
          expect(s.verdict.message).toContain('.property.test.ts, .law.test.ts')
        ),
      ),
    )

    scenario(
      'A verdict with fully recorded killers states the answer is exact',
      Gherkin.Do.pipe(
        Given('a report where every killer was recorded')('report', () =>
          Effect.succeed(
            earnsAndIdleReport(),
          )),
        When('the verdict is judged with every killer recorded')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: PROPERTY, everyKillerRecorded: true })),
        ),
        Then('the message claims exact killer recording')((s, expect) =>
          expect(s.verdict.message).toContain('every killing test was recorded')
        ),
      ),
    )

    scenario(
      'Each accused file appears on its own bulleted line',
      Gherkin.Do.pipe(
        Given('a report with two idle files')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1'], ['t1', 't2', 't3'])],
              {
                'earns.property.test.ts': ['t1'],
                'beta.property.test.ts': ['t2'],
                'alpha.property.test.ts': ['t3'],
              },
            ),
          )),
        When('the verdict is judged with every killer recorded')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: PROPERTY, everyKillerRecorded: true })),
        ),
        Then('each accused file is listed on its own bullet line')((s, expect) =>
          expect(s.verdict.message).toContain(
            '  - alpha.property.test.ts\n  - beta.property.test.ts',
          )
        ),
      ),
    )

    scenario(
      'Only schema property tests running yields no judgement for the default suffixes',
      Gherkin.Do.pipe(
        Given('a report whose only tests are schema property tests')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1'], ['t1', 't2'])],
              {
                'earns.schema.property.test.ts': ['t1'],
                'idle.schema.property.test.ts': ['t2'],
              },
            ),
          )),
        When('the verdict is judged with the schema default suffixes')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: defaultSuffixes, everyKillerRecorded: true })),
        ),
        Then('there is no judgement')((s, expect) => expect(s.verdict.message).toContain('so none was judged')),
      ),
    )

    scenario(
      'A workflow property test among schema tests still triggers judgement',
      Gherkin.Do.pipe(
        Given('a report with a workflow property test among schema ones')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1'], ['t1', 't2'])],
              {
                'earns.workflow.property.test.ts': ['t1'],
                'idle.workflow.property.test.ts': ['t2'],
              },
            ),
          )),
        When('the verdict is judged with the schema default suffixes')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: defaultSuffixes, everyKillerRecorded: true })),
        ),
        Then('the gate applies and the run fails')((s, expect) =>
          expect({ failed: s.verdict.failed }).toEqual({ failed: true })
        ),
      ),
    )

    scenario(
      'A custom suffix list judges the files it matches',
      Gherkin.Do.pipe(
        Given('a report with only schema property tests and a custom suffix list')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1'], ['t1', 't2'])],
              {
                'earns.schema.property.test.ts': ['t1'],
                'idle.schema.property.test.ts': ['t2'],
              },
            ),
          )),
        When('the verdict is judged with the schema suffix list')(
          'verdict',
          (s) =>
            Effect.sync(() =>
              judgedWith(s.report, { suffixes: ['.schema.property.test.ts'], everyKillerRecorded: true })
            ),
        ),
        Then('the custom suffix list applies and fails the run')((s, expect) =>
          expect({ failed: s.verdict.failed }).toEqual({ failed: true })
        ),
      ),
    )

    scenario(
      'A kill from an unknown test id credits no file and exempts its real coverer',
      Gherkin.Do.pipe(
        Given('a kill whose only killer id names no test file and a real file covers it')(
          'report',
          () =>
            Effect.succeed(
              reportOf([mutantOf('m1', 'Killed', ['ghost'], ['t1'])], {
                'a.property.test.ts': ['t1'],
                'b.property.test.ts': ['t2'],
              }),
            ),
        ),
        When('contribution is computed per file')(
          'contribution',
          (s) => Effect.sync(() => Object.fromEntries(contributionByTestFile(s.report))),
        ),
        Then('no real file is credited and the coverer is marked as covering an unattributed kill')((s, expect) =>
          expect({
            contribution: s.contribution,
            ghostCredited: Object.keys(s.contribution).includes('ghost'),
          }).toEqual({
            contribution: {
              'a.property.test.ts': { soleKills: 0, totalKills: 0, killableCovered: 1, coversUnattributedKill: true },
              'b.property.test.ts': { soleKills: 0, totalKills: 0, killableCovered: 0, coversUnattributedKill: false },
            },
            ghostCredited: false,
          })
        ),
      ),
    )

    scenario(
      'A file that only survives by covering an unattributed kill is not claimed as unique',
      Gherkin.Do.pipe(
        Given('a report where one file defends and another only survives by covering an unattributed kill')(
          'report',
          () =>
            Effect.succeed(
              reportOf(
                [
                  mutantOf('m1', 'Killed', ['t1'], ['t1']),
                  mutantOf('m2', 'Killed', ['ghost'], ['t2']),
                ],
                {
                  'earns.property.test.ts': ['t1'],
                  'exempt.property.test.ts': ['t2'],
                },
              ),
            ),
        ),
        When('the run is judged with exact killer recording')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: PROPERTY, everyKillerRecorded: true })),
        ),
        Then('the run passes with judged and exempt counts and never claims every file kills uniquely')((s, expect) =>
          expect({
            failed: s.verdict.failed,
            judged: s.verdict.message.includes('1 judged'),
            exempted: s.verdict.message.includes('1 exempted'),
            claimsUniqueKill: s.verdict.message.includes('kills a mutant nothing else kills'),
          }).toEqual({ failed: false, judged: true, exempted: true, claimsUniqueKill: false })
        ),
      ),
    )

    scenario(
      'Two files killing the same mutants fail the run without claiming a just-as-dead escape',
      Gherkin.Do.pipe(
        Given('a report where two files kill exactly the same mutants')('report', () =>
          Effect.succeed(
            reportOf(
              [
                mutantOf('m1', 'Killed', ['t1', 't2'], ['t1', 't2']),
                mutantOf('m2', 'Killed', ['t1', 't2'], ['t1', 't2']),
              ],
              {
                'a.property.test.ts': ['t1'],
                'b.property.test.ts': ['t2'],
              },
            ),
          )),
        When('the run is judged with exact killer recording')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: PROPERTY, everyKillerRecorded: true })),
        ),
        Then('the run fails but does not claim deleting them leaves every mutant just as dead')((s, expect) =>
          expect({
            failed: s.verdict.failed,
            claimsJustAsDead: s.verdict.message.includes('would leave every mutant just as dead'),
            claimsNotJustAsDead: s.verdict.message.includes('would not leave every mutant just as dead'),
            namesA: s.verdict.message.includes('a.property.test.ts'),
            namesB: s.verdict.message.includes('b.property.test.ts'),
          }).toEqual({
            failed: true,
            claimsJustAsDead: false,
            claimsNotJustAsDead: true,
            namesA: true,
            namesB: true,
          })
        ),
      ),
    )

    scenario(
      'Joint subsumption across accused files earns the just-as-dead verdict',
      Gherkin.Do.pipe(
        Given('a report where every mutant the accused files kill retains an outside killer')(
          'report',
          () =>
            Effect.succeed(
              reportOf(
                [
                  mutantOf('m1', 'Killed', ['t1', 't3'], ['t1', 't3']),
                  mutantOf('m2', 'Killed', ['t2', 't3'], ['t2', 't3']),
                  mutantOf('m3', 'Killed', ['t3'], ['t3']),
                ],
                {
                  'a.property.test.ts': ['t1'],
                  'b.property.test.ts': ['t2'],
                  'c.property.test.ts': ['t3'],
                },
              ),
            ),
        ),
        When('the run is judged with exact killer recording')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: PROPERTY, everyKillerRecorded: true })),
        ),
        Then('the run fails claiming the whole accused set is jointly deletable')((s, expect) =>
          expect({
            failed: s.verdict.failed,
            claimsJustAsDead: s.verdict.message.includes('would leave every mutant just as dead'),
            namesA: s.verdict.message.includes('a.property.test.ts'),
            namesB: s.verdict.message.includes('b.property.test.ts'),
            namesC: s.verdict.message.includes('c.property.test.ts'),
          }).toEqual({
            failed: true,
            claimsJustAsDead: true,
            namesA: true,
            namesB: true,
            namesC: false,
          })
        ),
      ),
    )

    scenario(
      'A zero-kill file is unjudged when it covered nothing killable and accused when it did',
      Gherkin.Do.pipe(
        Given('a report with one auditable idle file and one unauditable idle file')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1'], ['t1', 't2'])],
              {
                'earns.property.test.ts': ['t1'],
                'auditable.property.test.ts': ['t2'],
                'unauditable.property.test.ts': ['t3'],
              },
            ),
          )),
        When('toothless files are computed with every killer recorded and contribution is kept')(
          'result',
          (s) =>
            Effect.sync(() => {
              const contribution = contributionByTestFile(s.report)
              return {
                accused: judgedWith(s.report, EXACT).toothless,
                contribution: Object.fromEntries(contribution),
              }
            }),
        ),
        Then('only the auditable file is accused and the unauditable file is spared')((s, expect) =>
          expect({
            accused: s.result.accused,
            auditableCovered: s.result.contribution['auditable.property.test.ts']?.killableCovered,
            unauditableCovered: s.result.contribution['unauditable.property.test.ts']?.killableCovered,
          }).toEqual({
            accused: ['auditable.property.test.ts'],
            auditableCovered: 1,
            unauditableCovered: 0,
          })
        ),
      ),
    )

    scenario(
      'The judge reports an in-scope file with no killable coverage as unjudged',
      Gherkin.Do.pipe(
        Given('a report with one defending file and one file the report gave no killable mutant')(
          'report',
          () =>
            Effect.succeed(
              reportOf(
                [mutantOf('m1', 'Killed', ['t1'], ['t1'])],
                {
                  'earns.property.test.ts': ['t1'],
                  'unauditable.property.test.ts': ['t3'],
                },
              ),
            ),
        ),
        When('the run is judged with exact killer recording')(
          'verdict',
          (s) => Effect.sync(() => judgedWith(s.report, { suffixes: PROPERTY, everyKillerRecorded: true })),
        ),
        Then('the run passes reporting the bare file unjudged, never the unique-kill sentence')((s, expect) =>
          expect({
            failed: s.verdict.failed,
            judged: s.verdict.message.includes('1 judged'),
            unjudged: s.verdict.message.includes('1 unjudged'),
            claimsUniqueKill: s.verdict.message.includes('kills a mutant nothing else kills'),
          }).toEqual({ failed: false, judged: true, unjudged: true, claimsUniqueKill: false })
        ),
      ),
    )

    scenario(
      'An Ignored mutant is not counted as killable when judging who was offered one',
      Gherkin.Do.pipe(
        Given('a report whose only in-scope idle file covers only an Ignored mutant')('report', () =>
          Effect.succeed(
            reportOf(
              [mutantOf('m1', 'Killed', ['t1'], ['t1']), mutantOf('m2', 'Ignored', [], ['t2'])],
              {
                'earns.property.test.ts': ['t1'],
                'ignored-cover.property.test.ts': ['t2'],
              },
            ),
          )),
        When('toothless files are computed with every killer recorded and contribution is kept')(
          'result',
          (s) =>
            Effect.sync(() => {
              const contribution = contributionByTestFile(s.report)
              return {
                accused: judgedWith(s.report, EXACT).toothless,
                contribution: Object.fromEntries(contribution),
              }
            }),
        ),
        Then('the Ignored-only file is not accused and not counted as coverable')((s, expect) =>
          expect({
            accused: s.result.accused,
            ignoredCovered: s.result.contribution['ignored-cover.property.test.ts']?.killableCovered,
          }).toEqual({ accused: [], ignoredCovered: 0 })
        ),
      ),
    )
  })
