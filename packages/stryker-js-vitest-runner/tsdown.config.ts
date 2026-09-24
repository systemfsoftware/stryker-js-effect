import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

const internalArtifacts = ['main', 'stryker-setup']
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
    entry: {
      index: './src/mod.ts',
      'stryker-setup': './sandbox/stryker-setup.ts',
    },
    clean: true,
  },
  {
    ...shared,
    entry: { main: './src/main.ts' },
    platform: 'node',
    deps: {
      neverBundle: [/^vitest$/, /^vitest\//],
      alwaysBundle: [/./],
      onlyBundle: false,
      onlyImport: ['vitest'],
    },
  },
])
