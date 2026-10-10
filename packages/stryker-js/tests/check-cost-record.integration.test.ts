import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'

import {
  checkedOptionsOf,
  checkedWorkspaceFiles,
  dryRunOnlyOptionsOf,
  noTestsOptionsOf,
  noTestsWorkspaceFiles,
  type Observation,
  runReasonlessWorkspace,
  runWorkspace,
  uncheckedOptionsOf,
  uncheckedWorkspaceFiles,
} from './__fixtures__/check-cost-workspace.fixture.js'

const Feature = makeFeature({ it })

const LANES_OF_ONE_TEST_RUNNER_AND_ONE_CHECKER = 2

const idsWithStatus = (statuses: Readonly<Record<string, string>>, status: string): readonly string[] =>
  Object.entries(statuses).filter(([, seen]) => seen === status).map(([id]) => id)

const isMeasured = (actualMs: number | null | undefined): boolean =>
  typeof actualMs === 'number' && Number.isFinite(actualMs) && actualMs >= 0

const checkIsMeasuredAboveZero = (check: RunEvent.CheckDuration | null): boolean =>
  check !== null &&
  Match.value(check).pipe(
    Match.tag('measured', (measured) => measured.ms > 0),
    Match.orElse(() => false),
  )

const checkIsNotRun = (check: RunEvent.CheckDuration | null): boolean =>
  check !== null &&
  Match.value(check).pipe(
    Match.tag('not-run', () => true),
    Match.orElse(() => false),
  )

const reportingIsMeasured = (reporting: RunEvent.ReportingDuration | null): boolean =>
  reporting !== null &&
  Match.value(reporting).pipe(
    Match.tag('measured', (measured) => measured.ms >= 0),
    Match.orElse(() => false),
  )

const reportingFollowsMutationTest = (phases: ReadonlyArray<RunEvent.RunPhase>): boolean =>
  phases.includes('mutation-test') &&
  phases.includes('reporting') &&
  phases.indexOf('reporting') > phases.indexOf('mutation-test')

const reportingExitSummaryOf = (observed: Observation) => {
  const elapsedOf = (phase: RunEvent.RunPhase): number | null => {
    const marks = observed.marks.filter((mark) => mark.phase === phase)
    const last = marks[marks.length - 1]
    return last === undefined ? null : last.elapsedMs
  }
  const reportingAt = elapsedOf('reporting')
  const mutationTestAt = elapsedOf('mutation-test')
  return {
    reportingMarkIsMeasured: isMeasured(reportingAt),
    reportingMarkFollowsMutationTestMark: reportingAt !== null &&
      mutationTestAt !== null &&
      reportingAt >= mutationTestAt,
    noVerdictPublishesThePhaseDurations: observed.verdictReporting === null && observed.verdictCheck === null,
    noMutantWasRun: Object.keys(observed.statuses).length === 0,
  }
}

const budgetPricesOnlyTheVerdictsThatRanATest = (observed: Observation): boolean => {
  const testRunning = [
    ...idsWithStatus(observed.statuses, 'Killed'),
    ...idsWithStatus(observed.statuses, 'Survived'),
    ...idsWithStatus(observed.statuses, 'Timeout'),
  ]
  const { verdictBudget } = observed
  if (verdictBudget === null || testRunning.length === 0) return false
  const testWorkSeconds = testRunning.reduce((total, id) => total + (observed.streamCosts[id] ?? 0), 0) /
    LANES_OF_ONE_TEST_RUNNER_AND_ONE_CHECKER / 1000
  return Math.abs(verdictBudget.predictedSeconds - testWorkSeconds) <=
    Number.EPSILON * 8 * Math.max(1, verdictBudget.predictedSeconds)
}

const idsOfFile = (observed: Observation, suffix: string): readonly string[] =>
  Object.entries(observed.idsByFile).flatMap(([file, ids]) => (file.endsWith(suffix) ? ids : []))

const recordSummaryOf = (observed: Observation) => {
  const compileErrors = idsWithStatus(observed.statuses, 'CompileError')
  const rejectedIds = idsOfFile(observed, 'src/lib/rejected.ts')
  const noCoverage = idsWithStatus(observed.statuses, 'NoCoverage')
  const ignored = idsWithStatus(observed.statuses, 'Ignored')
  const finishedWithoutATest = [...compileErrors, ...noCoverage, ...ignored]
  const testRunning = [
    ...idsWithStatus(observed.statuses, 'Killed'),
    ...idsWithStatus(observed.statuses, 'Survived'),
  ]
  const coveredCompileErrors = compileErrors.filter((id) => (observed.costs[id]?.coveringTests ?? 0) > 0)
  return {
    compileErrorCountAboveZero: compileErrors.length > 0,
    compileErrorsRecordFiniteCosts: compileErrors.length > 0 &&
      compileErrors.every((id) => isMeasured(observed.costs[id]?.actualMs)),
    rejectedCountAboveZero: rejectedIds.length > 0,
    rejectedMutantsAreCompileErrorsChargedTheCheckTime: rejectedIds.length > 0 &&
      rejectedIds.every((id) => observed.statuses[id] === 'CompileError' && (observed.costs[id]?.actualMs ?? 0) > 0),
    noCoverageCountAboveZero: noCoverage.length > 0,
    noCoverageRecordsFiniteCosts: noCoverage.length > 0 &&
      noCoverage.every((id) => isMeasured(observed.costs[id]?.actualMs)),
    ignoredCountAboveZero: ignored.length > 0,
    ignoredRecordsZeroCosts: ignored.length > 0 && ignored.every((id) => observed.costs[id]?.actualMs === 0),
    noTestVerdictsPublishTheirMeasuredCostOnTheStream: finishedWithoutATest.length > 0 &&
      finishedWithoutATest.every((id) => observed.streamCosts[id] === observed.costs[id]?.actualMs),
    testRunningCountAtLeastTwo: testRunning.length >= 2,
    testRunningKeepsItsMeasuredTestTime: testRunning.length > 0 &&
      testRunning.every((id) =>
        isMeasured(observed.costs[id]?.actualMs) &&
        observed.costs[id]?.actualMs === observed.streamCosts[id] &&
        (observed.streamCosts[id] ?? 0) > 0
      ),
    coveredCompileErrorsCostLessThanTheirWholeSuitePrediction: coveredCompileErrors.length > 0 &&
      coveredCompileErrors.every((id) =>
        (observed.costs[id]?.actualMs ?? Number.POSITIVE_INFINITY) < (observed.costs[id]?.predictedMs ?? 0)
      ),
    budgetPricesOnlyTheVerdictsThatRanATest: budgetPricesOnlyTheVerdictsThatRanATest(observed),
    verdictCheckIsMeasured: checkIsMeasuredAboveZero(observed.verdictCheck),
    verdictReportingIsMeasured: reportingIsMeasured(observed.verdictReporting),
    reportingFollowsMutationTest: reportingFollowsMutationTest(observed.phases),
  }
}

Feature('The measured cost recorded for a verdict the engine decided without a test')
  .withLayer(Layer.empty)
  .live('the scenarios drive the real engine over the host filesystem, so the report it writes is the real one')
  .body(({ scenario }) => {
    scenario(
      'A checker rejects and ignores mutants, and the report records the check time it measured for them',
      Gherkin.Do.pipe(
        Given('a workspace whose covered modules are checked by a rejecting and ignoring checker')(
          'observed',
          () => runWorkspace(checkedWorkspaceFiles, checkedOptionsOf),
        ),
        Then(
          'the compile errors and the uncovered mutants carry a finite measured cost, the ignored mutants carry zero, the test-running mutants keep the measured test time the stream published, and the run budget prices only that test time',
        )(
          (s, expect) =>
            expect(recordSummaryOf(s.observed)).toEqual({
              compileErrorCountAboveZero: true,
              compileErrorsRecordFiniteCosts: true,
              rejectedCountAboveZero: true,
              rejectedMutantsAreCompileErrorsChargedTheCheckTime: true,
              noCoverageCountAboveZero: true,
              noCoverageRecordsFiniteCosts: true,
              ignoredCountAboveZero: true,
              ignoredRecordsZeroCosts: true,
              noTestVerdictsPublishTheirMeasuredCostOnTheStream: true,
              testRunningCountAtLeastTwo: true,
              testRunningKeepsItsMeasuredTestTime: true,
              coveredCompileErrorsCostLessThanTheirWholeSuitePrediction: true,
              budgetPricesOnlyTheVerdictsThatRanATest: true,
              verdictCheckIsMeasured: true,
              verdictReportingIsMeasured: true,
              reportingFollowsMutationTest: true,
            }),
        ),
      ),
    )

    scenario(
      'Without a checker an uncovered mutant records a zero cost rather than no cost at all',
      Gherkin.Do.pipe(
        Given('a workspace with no checker whose tests never reach one module')(
          'observed',
          () => runWorkspace(uncheckedWorkspaceFiles, uncheckedOptionsOf),
        ),
        Then('every uncovered mutant carries an actualMs of zero')((s, expect) => {
          const noCoverage = idsWithStatus(s.observed.statuses, 'NoCoverage')
          return expect({
            noCoverageCountAboveZero: noCoverage.length > 0,
            everyUncoveredMutantIsPricedAtZero: noCoverage.length > 0 &&
              noCoverage.every((id) => s.observed.costs[id]?.actualMs === 0),
            verdictCheckIsNotRun: checkIsNotRun(s.observed.verdictCheck),
          }).toEqual({
            noCoverageCountAboveZero: true,
            everyUncoveredMutantIsPricedAtZero: true,
            verdictCheckIsNotRun: true,
          })
        }),
      ),
    )

    scenario(
      'The no-tests exit enters the reporting phase after the mutation-test phase without publishing a verdict',
      Gherkin.Do.pipe(
        Given('a workspace whose test files match nothing and whose run allows an empty test set')(
          'observed',
          () => runWorkspace(noTestsWorkspaceFiles, noTestsOptionsOf),
        ),
        Then(
          'the run marks the mutation-test and reporting phases with a measured reporting mark, runs no mutant, and publishes no verdict to price the phases',
        )(
          (s, expect) =>
            expect(reportingExitSummaryOf(s.observed)).toEqual({
              reportingMarkIsMeasured: true,
              reportingMarkFollowsMutationTestMark: true,
              noVerdictPublishesThePhaseDurations: true,
              noMutantWasRun: true,
            }),
        ),
      ),
    )

    scenario(
      'The dry-run-only exit enters the reporting phase after the mutation-test phase without publishing a verdict',
      Gherkin.Do.pipe(
        Given('a workspace whose run stops after the dry run')(
          'observed',
          () => runWorkspace(uncheckedWorkspaceFiles, dryRunOnlyOptionsOf),
        ),
        Then(
          'the run marks the mutation-test and reporting phases with a measured reporting mark, runs no mutant, and publishes no verdict to price the phases',
        )(
          (s, expect) =>
            expect(reportingExitSummaryOf(s.observed)).toEqual({
              reportingMarkIsMeasured: true,
              reportingMarkFollowsMutationTestMark: true,
              noVerdictPublishesThePhaseDurations: true,
              noMutantWasRun: true,
            }),
        ),
      ),
    )

    scenario(
      'A checker that ignores a mutant without naming a rule fails the run, naming the checker and the mutant',
      Gherkin.Do.pipe(
        Given('a workspace whose checker answers ignored with no reason for one module')(
          'observed',
          () => runReasonlessWorkspace,
        ),
        Then('the run fails with the refusal, which names the checker plugin and the mutant id')(
          (s, expect) =>
            expect({ failed: s.observed.failed, failure: s.observed.failure }).toMatchObject({
              failed: true,
              failure: expect.stringMatching(
                /Checker "[^"]+" ignored mutant [0-9a-f]{16} without a reason naming a rule/u,
              ),
            }),
        ),
      ),
    )
  })
