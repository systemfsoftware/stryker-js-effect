export default {
  testRunner: {
    plugin: import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
  },
  checkers: [
    {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-effect-skew-checker'),
    },
  ],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
}
