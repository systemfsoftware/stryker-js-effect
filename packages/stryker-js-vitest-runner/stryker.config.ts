import { installedPlugin, sharedConfig } from '@systemfsoftware/stryker-config'
import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js/config'

const config = {
  ...sharedConfig,
  testRunner: {
    plugin: installedPlugin('@systemfsoftware/stryker-js-vitest-runner', import.meta.url),
    options: { configFile: 'vitest.config.ts', dir: '.', related: true },
  },
  checkers: [{ plugin: installedPlugin('@systemfsoftware/stryker-js-typescript-checker', import.meta.url) }],
  ignorers: [
    import.meta.resolve('@systemfsoftware/stryker-ignorer-effect-schema-declarations'),
    import.meta.resolve('@systemfsoftware/stryker-ignorer-in-source-vitest-block'),
  ],
  mutate: [
    'src/**/*.workflow.ts',
    'src/**/*.schema.ts',
    '!src/**/*.test.ts',
    '!src/**/*.property.test.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  dryRunTimeoutMinutes: 10,
  thresholds: { ...sharedConfig.thresholds, break: 69 },
} satisfies PartialStrykerOptions

export default config
