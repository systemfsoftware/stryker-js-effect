export default {
  testRunner: 'vitest',
  plugins: [
    import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
    import.meta.resolve('@systemfsoftware/stryker-js-effect-skew-checker'),
  ],
  checkers: ['skew'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
}
