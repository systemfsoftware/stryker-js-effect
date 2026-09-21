import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const srcDir = (packageName: string): string =>
  fileURLToPath(new URL(`./packages/${packageName}/src/`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@enterprise\/core$/, replacement: `${srcDir('core')}index.ts` },
      { find: /^@enterprise\/services$/, replacement: `${srcDir('services')}index.ts` },
      { find: /^@enterprise\/api$/, replacement: `${srcDir('api')}index.ts` },
      { find: /^@enterprise\/core\/(.+)$/, replacement: `${srcDir('core')}$1` },
      { find: /^@enterprise\/services\/(.+)$/, replacement: `${srcDir('services')}$1` },
      { find: /^@core\/(.+)$/, replacement: `${srcDir('core')}$1` },
      { find: /^#internal\/(.+)$/, replacement: `${srcDir('services')}$1` },
    ],
  },
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
  },
})
