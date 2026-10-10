import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { main: './src/main.ts' },
  format: 'esm',
  dts: true,
  tsconfig: './tsconfig.app.json',
  exports: sourceExports({ dtsExt: '.d.mts' }),
  clean: true,
  define: { 'import.meta.vitest': 'undefined' },
})
