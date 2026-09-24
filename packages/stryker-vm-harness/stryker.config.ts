import { sharedConfig } from '@systemfsoftware/stryker-config'
import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js/config'

const config = {
  ...sharedConfig,
  mutate: [
    'src/drain-registry.workflow.ts',
    'src/registry.handle.ts',
    'src/harness-api.handle.ts',
    'src/assertions.handle.ts',
    'src/harness-sources.handle.ts',
  ],
  testRunner: {
    plugin: import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
    options: { configFile: 'vitest.config.ts', dir: '.', related: true },
  },
  checkers: [
    {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
      options: { prioritizePerformanceOverAccuracy: true },
    },
  ],
  ignorers: [
    import.meta.resolve('@systemfsoftware/stryker-ignorer-effect-schema-declarations'),
    import.meta.resolve('@systemfsoftware/stryker-ignorer-in-source-vitest-block'),
  ],
  plugins: [
    import.meta.resolve('@systemfsoftware/stryker-test-contribution'),
  ],
} satisfies PartialStrykerOptions

export default config
