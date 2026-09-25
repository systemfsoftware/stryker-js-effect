import { installedPlugin, shardMutate, sharedConfig } from '@systemfsoftware/stryker-config'
import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js/config'

const config = {
  ...sharedConfig,
  mutate: shardMutate([
    'src/drain-registry.workflow.ts',
    'src/registry.handle.ts',
    'src/harness-api.handle.ts',
    'src/assertions.handle.ts',
    'src/harness-sources.handle.ts',
  ]),
  testRunner: {
    plugin: installedPlugin('@systemfsoftware/stryker-js-vitest-runner', import.meta.url),
    options: { configFile: 'vitest.mutation.config.ts', dir: '.', related: true },
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
  plugins: [
    import.meta.resolve('@systemfsoftware/stryker-test-contribution'),
  ],
  dryRunTimeoutMinutes: 10,
} satisfies PartialStrykerOptions

export default config
