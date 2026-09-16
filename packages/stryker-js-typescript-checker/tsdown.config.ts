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
    entry: { index: './src/index.ts' },
    clean: true,
    deps: { alwaysBundle: ['@std/jsonc'] },
  },
  {
    ...shared,
    entry: { worker: './src/main.ts' },
    deps: {
      neverBundle: [/^typescript$/, /^typescript\//],
      alwaysBundle: [
        /^effect$/,
        /^effect\//,
        /^@systemfsoftware\/stryker-js-language$/,
        /^@systemfsoftware\/stryker-js-plugin-interface$/,
        /^@systemfsoftware\/effect-cell-types$/,
        '@std/jsonc',
      ],
    },
  },
])
