export const strykerPlugins: readonly { readonly kind: 'Evaluator'; readonly name: string }[] = [
  { kind: 'Evaluator', name: 'test-contribution' },
]

export { makeTestContributionEvaluatorService, testContributionEvaluatorLayer } from './test-contribution-evaluator.service.js'
export {
  contributionByTestFile,
  defaultRequireTestContributionSuffixes,
  judgeTestContribution,
  toothlessTestFiles,
} from './test-contribution.js'
export type {
  ReportView,
  TestContributionInput,
  TestContributionVerdict,
  TestFileContribution,
} from './test-contribution.schema.js'
