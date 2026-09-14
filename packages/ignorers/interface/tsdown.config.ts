import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/mod.ts',
    testing: './src/testing.ts',
  },
  format: 'esm',
  dts: true,
  tsconfig: './tsconfig.build.json',
  clean: true,
  outExtensions: () => ({ js: '.mjs', dts: '.d.ts' }),
})
