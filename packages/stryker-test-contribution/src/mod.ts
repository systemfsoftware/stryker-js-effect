export const strykerPlugins: readonly { readonly kind: 'Evaluator'; readonly name: string }[] = [
  { kind: 'Evaluator', name: 'test-contribution' },
]

export * as Judge from './judge-test-contribution.workflow.js'
export * as TestContributionEvaluator from './test-contribution-evaluator.service.js'
export * as TestContribution from './test-contribution.schema.js'
