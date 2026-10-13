import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/mod.ts',
  },
  format: 'esm',
  dts: true,
  tsconfig: './tsconfig.build.json',
  exports: sourceExports({ dtsExt: '.d.mts', documents: ['./oxlint.config.ts'] }),

  clean: true,
  define: { 'import.meta.vitest': 'undefined' },
})
