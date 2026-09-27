import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

const baseExports = sourceExports({ dtsExt: '.d.mts' })

const contractSubpaths = {
  './contract/stream.schema.json': './contract/stream.schema.json',
  './contract/stock-catalog.json': './contract/stock-catalog.json',
  './contract/span-taxonomy.json': './contract/span-taxonomy.json',
}

export default defineConfig({
  entry: {
    index: './src/mod.ts',
  },
  format: 'esm',
  dts: true,
  tsconfig: './tsconfig.build.json',
  exports: {
    devExports: baseExports.devExports,
    customExports: (exports) => ({ ...baseExports.customExports(exports), ...contractSubpaths }),
  },

  clean: true,
  define: { 'import.meta.vitest': 'undefined' },
})
