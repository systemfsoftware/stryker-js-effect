import { sharedConfig } from '@systemfsoftware/stryker-config'
import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  ...sharedConfig,
  plugins: [
    import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
    import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
    import.meta.resolve('@systemfsoftware/stryker-test-contribution'),
    import.meta.resolve('@systemfsoftware/stryker-ignorer-effect-schema-declarations'),
    import.meta.resolve('@systemfsoftware/stryker-ignorer-in-source-vitest-block'),
  ],
})
