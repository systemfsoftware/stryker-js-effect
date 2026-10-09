import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import * as Layer from 'effect/Layer'

import {
  checkedOptionsOf,
  checkedWorkspaceFiles,
  type Observation,
  runWorkspace,
  uncheckedOptionsOf,
  uncheckedWorkspaceFiles,
} from './__fixtures__/check-cost-workspace.fixture.js'

const Feature = makeFeature({ it })

const LANES_OF_ONE_TEST_RUNNER_AND_ONE_CHECKER = 2

const idsWithStatus = (statuses: Readonly<Record<string, string>>, status: string): readonly string[] =>
  Object.entries(statuses).filter(([, seen]) => seen === status).map(([id]) => id)

const isMeasured = (costMs: number | undefined): boolean =>
  typeof costMs === 'number' && Number.isFinite(costMs) && costMs >= 0

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
  return {
    compileErrorCountAboveZero: compileErrors.length > 0,
    compileErrorsRecordFiniteCosts: compileErrors.length > 0 &&
      compileErrors.every((id) => isMeasured(observed.costs[id])),
    rejectedCountAboveZero: rejectedIds.length > 0,
    rejectedMutantsAreCompileErrorsChargedTheCheckTime: rejectedIds.length > 0 &&
      rejectedIds.every((id) => observed.statuses[id] === 'CompileError' && (observed.costs[id] ?? 0) > 0),
    noCoverageCountAboveZero: noCoverage.length > 0,
    noCoverageRecordsFiniteCosts: noCoverage.length > 0 &&
      noCoverage.every((id) => isMeasured(observed.costs[id])),
    ignoredCountAboveZero: ignored.length > 0,
    ignoredRecordsZeroCosts: ignored.length > 0 && ignored.every((id) => observed.costs[id] === 0),
    noTestVerdictsPublishTheirMeasuredCostOnTheStream: finishedWithoutATest.length > 0 &&
      finishedWithoutATest.every((id) => observed.streamCosts[id] === observed.costs[id]),
    testRunningCountAtLeastTwo: testRunning.length >= 2,
    testRunningKeepsItsMeasuredTestTime: testRunning.length > 0 &&
      testRunning.every((id) =>
        isMeasured(observed.costs[id]) &&
        observed.costs[id] === observed.streamCosts[id] &&
        (observed.streamCosts[id] ?? 0) > 0
      ),
    budgetPricesOnlyTheVerdictsThatRanATest: budgetPricesOnlyTheVerdictsThatRanATest(observed),
  }
}

Feature('The measured cost recorded for a verdict the engine decided without a test')
  .withLayer(Layer.empty)
  .live('the scenarios drive the real engine over the host filesystem, so the verdict store it writes is the real one')
  .body(({ scenario }) => {
    scenario(
      'A checker rejects and ignores mutants, and the store records the check time it measured for them',
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
              budgetPricesOnlyTheVerdictsThatRanATest: true,
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
        Then('every uncovered mutant is stored with a cost of zero')((s, expect) => {
          const noCoverage = idsWithStatus(s.observed.statuses, 'NoCoverage')
          return expect({
            noCoverageCountAboveZero: noCoverage.length > 0,
            everyUncoveredMutantIsPricedAtZero: noCoverage.length > 0 &&
              noCoverage.every((id) => s.observed.costs[id] === 0),
          }).toEqual({ noCoverageCountAboveZero: true, everyUncoveredMutantIsPricedAtZero: true })
        }),
      ),
    )
  })
