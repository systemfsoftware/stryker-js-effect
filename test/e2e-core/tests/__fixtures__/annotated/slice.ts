import type { PlacementSliceEncoded } from '../placement-slice.schema.js'

export const annotatedSampleSlice: PlacementSliceEncoded = {
  id: 'annotated-sample',
  fixtureDir: 'test/e2e-core/tests/__fixtures__/annotated',
  mutateFiles: ['src/arithmetic.ts', 'src/effect-concurrency.ts'],
  packageGlobs: ['.'],
  excludedMutations: ['UpdateOperator'],
  optInMutations: ['AtomicUpdateSplit', 'SynchronizationRemoval', 'FinalizerEscape'],
  providerModules: ['provider.mjs'],
  coverageAnalysis: 'perTest',
  waivers: [],
}
