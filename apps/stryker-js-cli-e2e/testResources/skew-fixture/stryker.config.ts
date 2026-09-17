export default {
  testRunner: 'vitest',
  plugins: [
    '@systemfsoftware/stryker-js-vitest-runner',
    '@systemfsoftware/stryker-js-effect-skew-checker',
  ],
  checkers: ['skew'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
}
