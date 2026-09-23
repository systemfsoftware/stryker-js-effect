import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

const internalArtifacts = ['main']
const exports = { ...sourceExports({ dtsExt: '.d.mts' }), exclude: internalArtifacts }

const shared = {
  format: 'esm' as const,
  dts: true,
  tsconfig: './tsconfig.build.json',
  exports,
  define: { 'import.meta.vitest': 'undefined' },
}

export default defineConfig([
  {
    ...shared,
    entry: { index: './src/mod.ts' },
    clean: true,
    deps: { alwaysBundle: ['@std/jsonc'] },
  },
  {
    ...shared,
    entry: { main: './src/main.ts' },
    platform: 'node',
    deps: {
      neverBundle: [/^typescript$/, /^typescript\//],
      alwaysBundle: [/./],
      onlyBundle: false,
      onlyImport: ['typescript'],
    },
  },
])
