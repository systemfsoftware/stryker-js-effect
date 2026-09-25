import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    include: [
      'tests/**/*.integration.test.ts',
      'tests/**/*.differential.test.ts',
      'src/**/__tests__/*.test.ts',
    ],
    exclude: [
      ...(sharedConfig.test?.exclude ?? []),
      '**/.stryker-tmp/**',
    ],
    testTimeout: 60000,
    hookTimeout: 60000,
    server: {
      deps: {
        inline: sharedConfig.test?.server?.deps?.inline ?? [],
        external: [...(sharedConfig.test?.server?.deps?.external ?? []), /\/src\/native-import\.ts$/],
      },
    },
  },
})
