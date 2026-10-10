import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { main: './src/main.ts' },
  format: 'esm',
  dts: false,
  clean: true,
  define: { 'import.meta.vitest': 'undefined' },
})
