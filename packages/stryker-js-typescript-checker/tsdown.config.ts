import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

const internalArtifacts = ['main']
const exports = { ...sourceExports({ dtsExt: '.d.mts' }), exclude: internalArtifacts }

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
    entry: { main: './src/main.ts' },
    deps: {
      neverBundle: [/^typescript$/, /^typescript\//],
      alwaysBundle: [
        /^effect$/,
        /^effect\//,
        /^@systemfsoftware\/stryker-js-language$/,
        /^@systemfsoftware\/stryker-js-plugin-interface$/,
        /^@systemfsoftware\/stryker-js-plugin-runtime$/,
        /^@systemfsoftware\/effect-cell-types$/,
        '@std/jsonc',
      ],
    },
  },
])
