import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/index.ts',
    'builtin-reporters': './src/builtin-reporters.ts',
    'plugin-loader': './src/plugin-loader.ts',
  },
  format: 'esm',
  dts: true,
  exports: sourceExports({ dtsExt: '.d.mts' }),

  deps: { alwaysBundle: ['@std/jsonc'] },
  clean: true,
  define: { 'import.meta.vitest': 'undefined' },
})
