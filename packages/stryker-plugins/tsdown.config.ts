import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/mod.ts',
    'effect-schema-ignorer': './src/effect-schema-ignorer/index.ts',
    'in-source-test-ignorer': './src/in-source-test-ignorer/index.ts',
    'workflow-make-ignorer': './src/workflow-make-ignorer/index.ts',
  },
  format: 'esm',
  dts: true,
  tsconfig: './tsconfig.build.json',
  clean: true,
  outExtensions: () => ({ js: '.mjs', dts: '.d.ts' }),
  deps: {
    onlyBundle: false,
  },
})
