import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  testFiles: ['src/order.vm.test.ts', 'src/attribution/consumer.vm.test.ts'],
  checkers: [{ plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker') }],
  tsconfigFile: 'tsconfig.references.json',
  reporters: ['json'],
  mutate: ['src/order.ts', 'src/attribution/payload.ts', 'src/attribution/prefix.ts'],
})
