export const strykerPlugins: readonly { readonly kind: 'Evaluator'; readonly name: string }[] = [
  { kind: 'Evaluator', name: 'test-contribution' },
]

export { makeTestContributionEvaluatorService, testContributionEvaluatorLayer } from './test-contribution-evaluator.service.js'
export {
  BailHidesKillers,
  JointlyDeletable,
  JudgeTestContribution,
  judgeTestContribution,
  NoKillCredited,
  NotJointlyDeletable,
  RunReviewed,
  RunUnjudged,
} from './judge-test-contribution.workflow.js'
export type { TestContributionDecision } from './judge-test-contribution.workflow.js'
export type { ReportView, TestFileContribution } from './test-contribution.schema.js'
