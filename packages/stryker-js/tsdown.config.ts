import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/index.ts',
    config: './src/config/index.ts',
    promises: './src/promises/index.ts',
    'builtin-reporters': './src/builtin-reporters.ts',
    'plugin-loader': './src/plugin-loader.ts',
  },
  format: 'esm',
  dts: true,
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
