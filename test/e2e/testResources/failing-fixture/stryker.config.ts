export default {
  testRunner: {
    plugin: import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
  },
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
}
