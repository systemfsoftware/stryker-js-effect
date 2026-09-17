import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/index.ts',
  },
  format: 'esm',
  dts: true,
  exports: sourceExports({ dtsExt: '.d.mts' }),

  clean: true,
  define: { 'import.meta.vitest': 'undefined' },
})
