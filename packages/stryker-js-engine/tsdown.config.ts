import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

export default defineConfig({
  format: 'esm',
  tsconfig: '../stryker-js/tsconfig.build.json',
  define: { 'import.meta.vitest': 'undefined' },
  entry: { index: '../stryker-js/src/mod.ts' },
  clean: true,
  dts: true,
  exports: sourceExports({ dtsExt: '.d.mts' }),
  deps: {
    alwaysBundle: ['@std/jsonc'],
    onlyImport: [
      /^node:/,
      /^effect(\/|$)/,
      '@effect/platform-node',
      '@effect/platform-node-shared',
      '@noble/hashes',
      '@opentelemetry/api',
      '@systemfsoftware/effect-cell-types',
      '@systemfsoftware/stryker-framework-interface',
      '@systemfsoftware/stryker-ignorer-interface',
      '@systemfsoftware/stryker-js-cli-contract',
      '@systemfsoftware/stryker-js-html-reporter',
      '@systemfsoftware/stryker-js-instrumenter',
      '@systemfsoftware/stryker-js-plugin-interface',
      '@systemfsoftware/stryker-js-plugin-runtime',
      'yaml',
    ],
  },
})
