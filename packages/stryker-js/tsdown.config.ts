import { SOURCE_CONDITION, withSourceFirst } from '@systemfsoftware/tsdown-config'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

import wasiManifest from '@oxc-parser/binding-wasm32-wasi/package.json' with { type: 'json' }
import parserManifest from 'oxc-parser/package.json' with { type: 'json' }

if (parserManifest.version !== wasiManifest.version) {
  throw new Error(
    `oxc-parser@${parserManifest.version} is aliased to @oxc-parser/binding-wasm32-wasi@${wasiManifest.version}; the parser binds its own version's WebAssembly ABI, so the two must match exactly.`,
  )
}

const resolvePath = (specifier: string): string => new URL(import.meta.resolve(specifier)).pathname

const parserEntry = resolvePath('oxc-parser/src-js/wasm.js')
const wasiModule = resolvePath('@oxc-parser/binding-wasm32-wasi/parser.wasm32-wasi.wasm')
const htmlReporterClientBundle = resolvePath('mutation-testing-elements/dist/mutation-test-elements.js')

const shared = {
  format: 'esm' as const,
  tsconfig: './tsconfig.build.json',
  define: { 'import.meta.vitest': 'undefined' },
}

const DTS_EXT = '.d.mts'

const injectTypes = (exports: Record<string, any>, { isPublish }: { readonly isPublish: boolean }) => {
  for (const [key, value] of Object.entries(exports)) {
    if (key === './package.json') continue
    exports[key] = withSourceFirst(value, DTS_EXT)
  }
  return isPublish ? exports : { '.': { [SOURCE_CONDITION]: './src/mod.ts' }, ...exports }
}

const bundledLibraries = [
  '@std/jsonc',
  '@systemfsoftware/effect-cell-types',
  '@systemfsoftware/stryker-framework-interface',
  '@systemfsoftware/stryker-ignorer-interface',
  '@systemfsoftware/stryker-js-cli-contract',
  '@systemfsoftware/stryker-js-html-reporter',
  '@systemfsoftware/stryker-js-instrumenter',
  '@systemfsoftware/stryker-js-plugin-interface',
  '@systemfsoftware/stryker-js-plugin-runtime',
]

export default defineConfig([
  {
    ...shared,
    entry: {
      config: './src/config/mod.ts',
      promises: './src/promises/mod.ts',
      events: './src/events/mod.ts',
    },
    dts: true,
    exports: { devExports: '@systemfsoftware/source', customExports: injectTypes },

    deps: {
      alwaysBundle: [/^effect(\/|$)/, /^@effect\//, ...bundledLibraries],
      onlyImport: [/^node:/, '@noble/hashes', '@opentelemetry/api'],
    },
  },
  {
    ...shared,
    entry: { published: './src/published.ts' },
    outDir: './temp/api',
    dts: { emitDtsOnly: true },
    deps: {
      alwaysBundle: bundledLibraries,
      neverBundle: [/^effect(\/|$)/],
    },
  },
  {
    ...shared,
    entry: {
      main: './src/bin/main.ts',
    },
    dts: false,
    outExtensions: () => ({ js: '.mjs' }),
    define: {
      ...shared.define,
      __STRYKER_HTML_REPORTER_CLIENT_BUNDLE__: JSON.stringify(readFileSync(htmlReporterClientBundle, 'utf8')),
    },
    platform: 'node',
    shims: true,
    alias: { 'oxc-parser': parserEntry },
    copy: [{ from: wasiModule, rename: 'parser.wasm32-wasi.wasm' }],
    deps: { alwaysBundle: [/./], onlyImport: [/^node:/], onlyBundle: false },
  },
])
