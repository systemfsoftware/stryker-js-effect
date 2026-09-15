import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/mod.ts',
    tester: './src/tester.ts',
  },
  format: 'esm',
  dts: true,
  tsconfig: './tsconfig.build.json',
  clean: true,
  outExtensions: () => ({ js: '.mjs', dts: '.d.ts' }),
})
