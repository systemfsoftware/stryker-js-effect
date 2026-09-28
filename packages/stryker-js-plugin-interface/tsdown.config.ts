import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

const baseExports = sourceExports({ dtsExt: '.d.mts' })

const contractSubpaths = { './contract/report.schema.json': './contract/report.schema.json' }

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
