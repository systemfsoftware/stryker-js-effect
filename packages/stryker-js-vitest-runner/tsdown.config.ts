import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

const exports = sourceExports({ dtsExt: '.d.mts' })

const shared = {
  format: 'esm' as const,
  dts: true,
  exports,
  define: { 'import.meta.vitest': 'undefined' },
}

export default defineConfig([
  {
    ...shared,
    entry: {
      index: './src/index.ts',
      'stryker-setup': './src/stryker-setup.ts',
    },
    clean: true,
  },
  {
    ...shared,
    entry: { worker: './src/main.ts' },
    deps: {
      neverBundle: [/^vitest$/, /^vitest\//],
      alwaysBundle: [
        /^effect$/,
        /^effect\//,
        /^@systemfsoftware\/stryker-js-language$/,
        /^@systemfsoftware\/stryker-js-plugin-interface$/,
        /^@systemfsoftware\/effect-cell-types$/,
      ],
    },
  },
])
