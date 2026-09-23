import { Schema } from 'effect'

import { OracleSliceId, type OracleSliceId as OracleSliceIdType } from './baseline.schema.js'

export class OracleSliceConfig extends Schema.Class<OracleSliceConfig>('OracleSliceConfig')({
  id: OracleSliceId,
  journey: Schema.String,
  fixtureDir: Schema.String,
  strykerConfig: Schema.String,
  mutateFiles: Schema.Array(Schema.String),
  packageGlobs: Schema.Array(Schema.String),
  excludedMutations: Schema.Array(Schema.String),
  journeyUsesTally: Schema.Boolean,
  survivedFloorBand: Schema.Boolean,
  timeoutFloorBand: Schema.Boolean,
}) {
  static readonly FIXTURE_DIR = 'test/e2e/testResources/enterprise-monorepo-fixture'

  static readonly SLICES: Readonly<Record<OracleSliceIdType, OracleSliceConfig>> = Object.freeze({
    lifecycle: OracleSliceConfig.make({
      id: 'lifecycle',
      journey: 'test/e2e/tests/enterprise-mutation-lifecycle.e2e.test.ts',
      fixtureDir: OracleSliceConfig.FIXTURE_DIR,
      strykerConfig: 'stryker.config.ts',
      mutateFiles: ['packages/*/src/**/*.ts', '!packages/*/src/**/*.test.ts', '!packages/services/src/nontermination.ts'],
      excludedMutations: [],
      journeyUsesTally: true,
      survivedFloorBand: false,
      timeoutFloorBand: false,
      packageGlobs: ['packages/core', 'packages/services', 'packages/api', 'packages/analytics'],
    }),
    edge: OracleSliceConfig.make({
      id: 'edge',
      journey: 'test/e2e/tests/enterprise-mutator-edge-cases.e2e.test.ts',
      fixtureDir: OracleSliceConfig.FIXTURE_DIR,
      strykerConfig: 'stryker.edge.config.ts',
      mutateFiles: ['packages/services/src/inventory.ts'],
      excludedMutations: ['ConditionalExpression', 'EqualityOperator'],
      journeyUsesTally: true,
      survivedFloorBand: false,
      timeoutFloorBand: false,
      packageGlobs: ['packages/services'],
    }),
    checker: OracleSliceConfig.make({
      id: 'checker',
      journey: 'test/e2e/tests/enterprise-composite-checker.e2e.test.ts',
      fixtureDir: OracleSliceConfig.FIXTURE_DIR,
      strykerConfig: 'stryker.checker.config.ts',
      mutateFiles: ['packages/core/src/contracts.ts', 'packages/api/src/report.ts'],
      excludedMutations: [],
      journeyUsesTally: true,
      survivedFloorBand: false,
      timeoutFloorBand: false,
      packageGlobs: ['packages/core', 'packages/api'],
    }),
    resilience: OracleSliceConfig.make({
      id: 'resilience',
      journey: 'test/e2e/tests/enterprise-runner-resilience.e2e.test.ts',
      fixtureDir: OracleSliceConfig.FIXTURE_DIR,
      strykerConfig: 'stryker.resilience.config.ts',
      mutateFiles: ['packages/services/src/nontermination.ts'],
      excludedMutations: [],
      journeyUsesTally: false,
      survivedFloorBand: false,
      timeoutFloorBand: false,
      packageGlobs: ['packages/services'],
    }),
  })
}
