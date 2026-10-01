import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

const documents = [
  './contract/stream.schema.json',
  './contract/stock-catalog.json',
  './contract/span-taxonomy.json',
]

export default defineConfig({
  entry: {
    index: './src/mod.ts',
  },
  format: 'esm',
  dts: true,
  tsconfig: './tsconfig.build.json',
  exports: sourceExports({ dtsExt: '.d.mts', documents }),

  clean: true,
  define: { 'import.meta.vitest': 'undefined' },
})
