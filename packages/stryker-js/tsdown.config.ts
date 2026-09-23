import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/mod.ts',
    config: './src/config/mod.ts',
    promises: './src/promises/mod.ts',
    events: './src/events/mod.ts',
  },
  format: 'esm',
  dts: true,
  tsconfig: './tsconfig.build.json',
  exports: sourceExports({ dtsExt: '.d.mts' }),

  deps: {
    alwaysBundle: [
      '@std/jsonc',
      '@systemfsoftware/stryker-ignorer-interface',
      '@systemfsoftware/stryker-js-html-reporter',
      '@systemfsoftware/stryker-js-instrumenter',
      '@systemfsoftware/stryker-js-plugin-interface',
      '@systemfsoftware/stryker-js-plugin-runtime',
    ],
  },
  clean: false,
  define: { 'import.meta.vitest': 'undefined' },
})
