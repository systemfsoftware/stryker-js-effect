import { installedPlugin, shardMutate, sharedConfig } from '@systemfsoftware/stryker-config'
import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js/config'

const config = {
  ...sharedConfig,
  testRunner: {
    plugin: installedPlugin('@systemfsoftware/stryker-js-vitest-runner', import.meta.url),
    options: { configFile: 'vitest.config.ts', dir: '.', related: true },
  },
  checkers: [
    {
      plugin: installedPlugin('@systemfsoftware/stryker-js-typescript-checker', import.meta.url),
      options: { prioritizePerformanceOverAccuracy: true },
    },
  ],
  ignorers: [
    import.meta.resolve('@systemfsoftware/stryker-ignorer-effect-schema-declarations'),
    import.meta.resolve('@systemfsoftware/stryker-ignorer-in-source-vitest-block'),
  ],
  mutate: shardMutate([
    'src/**/*.workflow.ts',
    'src/**/*.schema.ts',
    '!src/**/*.test.ts',
    '!src/**/*.property.test.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ]),
  dryRunTimeoutMinutes: 10,
} satisfies PartialStrykerOptions

export default config
