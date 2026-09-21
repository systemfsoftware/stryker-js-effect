import { fileURLToPath } from 'node:url'

/**
 * Slice registry: the four registered enterprise slices and their fixture-
 * relative configuration, read verbatim from the authored stryker.*.config.ts
 * files in test/e2e/testResources/enterprise-monorepo-fixture/ and the four
 * enterprise e2e.test.ts journeys that assert them.
 *
 * Sabotage (stryker.sabotage.config.ts, enterprise-monorepo-sabotage.e2e.test.ts)
 * is NOT registered — R9.
 */
export interface OracleSliceConfig {
  readonly id: 'lifecycle' | 'edge' | 'checker' | 'resilience'
  readonly journey: string
  readonly fixtureDir: string
  readonly strykerConfig: string
  readonly mutateFiles: readonly string[]
  readonly excludedMutations: readonly string[]
  readonly packageGlobs: readonly string[]
}

export const ENTERPRISE_FIXTURE_DIR = fileURLToPath(
  new URL('../../testResources/enterprise-monorepo-fixture', import.meta.url),
)

export const ORACLE_SLICES: Readonly<Record<OracleSliceConfig['id'], OracleSliceConfig>> = Object.freeze({
  lifecycle: {
    id: 'lifecycle',
    journey: 'test/e2e/tests/enterprise-mutation-lifecycle.e2e.test.ts',
    fixtureDir: ENTERPRISE_FIXTURE_DIR,
    strykerConfig: 'stryker.config.ts',
    mutateFiles: ['packages/*/src/**/*.ts', '!packages/*/src/**/*.test.ts'],
    excludedMutations: [],
    packageGlobs: ['packages/core', 'packages/services', 'packages/api', 'packages/analytics'],
  },
  edge: {
    id: 'edge',
    journey: 'test/e2e/tests/enterprise-mutator-edge-cases.e2e.test.ts',
    fixtureDir: ENTERPRISE_FIXTURE_DIR,
    strykerConfig: 'stryker.edge.config.ts',
    mutateFiles: ['packages/services/src/inventory.ts'],
    excludedMutations: ['ConditionalExpression', 'EqualityOperator'],
    packageGlobs: ['packages/services'],
  },
  checker: {
    id: 'checker',
    journey: 'test/e2e/tests/enterprise-composite-checker.e2e.test.ts',
    fixtureDir: ENTERPRISE_FIXTURE_DIR,
    strykerConfig: 'stryker.checker.config.ts',
    mutateFiles: ['packages/core/src/contracts.ts', 'packages/api/src/report.ts'],
    excludedMutations: [],
    packageGlobs: ['packages/core', 'packages/api'],
  },
  resilience: {
    id: 'resilience',
    journey: 'test/e2e/tests/enterprise-runner-resilience.e2e.test.ts',
    fixtureDir: ENTERPRISE_FIXTURE_DIR,
    strykerConfig: 'stryker.resilience.config.ts',
    mutateFiles: ['packages/services/src/concurrency.ts'],
    excludedMutations: [],
    packageGlobs: ['packages/services'],
  },
})

export function listRegisteredSlices(): readonly OracleSliceConfig[] {
  return Object.values(ORACLE_SLICES)
}
