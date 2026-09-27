import { annotatedSampleSlice } from './annotated/slice.js'
import type { PlacementSliceEncoded } from './placement-slice.schema.js'

const ENTERPRISE_FIXTURE_DIR = 'test/e2e/testResources/enterprise-monorepo-fixture'

const ENTERPRISE_PACKAGE_GLOBS: ReadonlyArray<string> = [
  'packages/core',
  'packages/services',
  'packages/analytics',
  'packages/api',
]

export const enterpriseLifecycleSlice: PlacementSliceEncoded = {
  id: 'stryker.config.ts',
  fixtureDir: ENTERPRISE_FIXTURE_DIR,
  mutateFiles: [
    'packages/*/src/**/*.ts',
    '!packages/*/src/**/*.test.ts',
    '!packages/services/src/nontermination.ts',
  ],
  packageGlobs: ENTERPRISE_PACKAGE_GLOBS,
  excludedMutations: [],
  optInMutations: ['FinalizerEscape'],
  providerModules: ['provider.mjs'],
  coverageAnalysis: 'perTest',
  waivers: [],
}

export const enterpriseEdgeSlice: PlacementSliceEncoded = {
  id: 'stryker.edge.config.ts',
  fixtureDir: ENTERPRISE_FIXTURE_DIR,
  mutateFiles: ['packages/services/src/inventory.ts'],
  packageGlobs: ['packages/services'],
  excludedMutations: ['ConditionalExpression', 'EqualityOperator'],
  optInMutations: [],
  providerModules: [],
  coverageAnalysis: 'perTest',
  waivers: [],
}

export const enterpriseCheckerSlice: PlacementSliceEncoded = {
  id: 'stryker.checker.config.ts',
  fixtureDir: ENTERPRISE_FIXTURE_DIR,
  mutateFiles: ['packages/core/src/contracts.ts', 'packages/api/src/report.ts'],
  packageGlobs: ['packages/core', 'packages/api'],
  excludedMutations: [],
  optInMutations: [],
  providerModules: [],
  coverageAnalysis: 'perTest',
  waivers: [],
}

export const enterpriseResilienceSlice: PlacementSliceEncoded = {
  id: 'stryker.resilience.config.ts',
  fixtureDir: ENTERPRISE_FIXTURE_DIR,
  mutateFiles: ['packages/services/src/nontermination.ts'],
  packageGlobs: ['packages/services'],
  excludedMutations: [],
  optInMutations: [],
  providerModules: [],
  coverageAnalysis: 'perTest',
  waivers: [],
}

export const calcFixtureSlice: PlacementSliceEncoded = {
  id: 'stryker.config.ts',
  fixtureDir: 'test/e2e/testResources/calc-fixture',
  mutateFiles: ['src/**/*.ts', '!src/**/*.test.ts'],
  packageGlobs: [],
  excludedMutations: [],
  optInMutations: [],
  providerModules: [],
  coverageAnalysis: 'perTest',
  waivers: [],
}

export const svelteAppFixtureSlice: PlacementSliceEncoded = {
  id: 'stryker.config.ts',
  fixtureDir: 'test/e2e/testResources/svelte-app-fixture',
  mutateFiles: ['src/**/*.svelte', 'src/**/*.ts', '!src/**/*.test.ts'],
  packageGlobs: [],
  excludedMutations: [],
  optInMutations: [],
  providerModules: [],
  coverageAnalysis: 'perTest',
  waivers: [],
}

export const vitestNestedDescribeFixtureSlice: PlacementSliceEncoded = {
  id: 'stryker.config.ts',
  fixtureDir: 'test/e2e/testResources/vitest-nested-describe-fixture',
  mutateFiles: ['src/**/*.ts'],
  packageGlobs: [],
  excludedMutations: [],
  optInMutations: [],
  providerModules: [],
  coverageAnalysis: 'perTest',
  waivers: [],
}

export const vmVitestFixtureSlice: PlacementSliceEncoded = {
  id: 'stryker.config.ts',
  fixtureDir: 'test/e2e/testResources/vm-vitest-fixture',
  mutateFiles: ['src/**/*.ts', '!src/**/*.test.ts'],
  packageGlobs: [],
  excludedMutations: [],
  optInMutations: [],
  providerModules: [],
  coverageAnalysis: 'perTest',
  waivers: [],
}

const CHECKER_FIXTURE_DIR = 'test/e2e/testResources/typescript-checker-fixture'

export const checkerReferencesSlice: PlacementSliceEncoded = {
  id: 'stryker.references.config.ts',
  fixtureDir: CHECKER_FIXTURE_DIR,
  mutateFiles: ['src/order.ts'],
  packageGlobs: ['.'],
  excludedMutations: [],
  optInMutations: [],
  providerModules: [],
  coverageAnalysis: 'perTest',
  waivers: [],
}

export const checkerPreservationSlice: PlacementSliceEncoded = {
  id: 'stryker.preservation.config.ts',
  fixtureDir: CHECKER_FIXTURE_DIR,
  mutateFiles: ['src/order.ts'],
  packageGlobs: ['.'],
  excludedMutations: [],
  optInMutations: [],
  providerModules: [],
  coverageAnalysis: 'perTest',
  waivers: [],
}

export const checkerPresetSlice: PlacementSliceEncoded = {
  id: 'stryker.preset.config.ts',
  fixtureDir: CHECKER_FIXTURE_DIR,
  mutateFiles: ['src/first.ts'],
  packageGlobs: ['placement/preset'],
  excludedMutations: [],
  optInMutations: [],
  providerModules: [],
  coverageAnalysis: 'perTest',
  waivers: [],
}

export const checkerVmSlice: PlacementSliceEncoded = {
  id: 'stryker.vm.config.ts',
  fixtureDir: CHECKER_FIXTURE_DIR,
  mutateFiles: ['src/order.ts'],
  packageGlobs: ['.'],
  excludedMutations: [],
  optInMutations: [],
  providerModules: [],
  coverageAnalysis: 'perTest',
  waivers: [],
}

export const placementSlices: readonly PlacementSliceEncoded[] = [
  annotatedSampleSlice,
  enterpriseLifecycleSlice,
  enterpriseEdgeSlice,
  enterpriseCheckerSlice,
  enterpriseResilienceSlice,
  calcFixtureSlice,
  svelteAppFixtureSlice,
  vitestNestedDescribeFixtureSlice,
  vmVitestFixtureSlice,
  checkerReferencesSlice,
  checkerPreservationSlice,
  checkerPresetSlice,
  checkerVmSlice,
]
