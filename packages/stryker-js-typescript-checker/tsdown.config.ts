import { defineConfig } from 'tsdown'

const CONDITION = '@systemfsoftware/source'

const toTypesPath = (mjsPath: string): string => mjsPath.replace(/\.mjs$/, '.d.mts')

type ExportEntry = string | { [key: string]: string | undefined; default: string }

const withTypesFirst = (entry: ExportEntry): ExportEntry => {
  if (typeof entry === 'string') return { types: toTypesPath(entry), default: entry }
  const ordered: { [key: string]: string | undefined; default: string } = { default: entry.default }
  if (entry[CONDITION] != null) ordered[CONDITION] = entry[CONDITION]
  ordered.types = entry.types ?? toTypesPath(entry.default)
  return ordered
}

export default defineConfig({
  entry: {
    index: './src/index.ts',
  },
  format: 'esm',
  dts: true,
  exports: {
    devExports: CONDITION,
    customExports: (exports: Record<string, ExportEntry>) => {
      for (const [key, value] of Object.entries(exports)) {
        if (key === './package.json') continue
        exports[key] = withTypesFirst(value)
      }
      return exports
    },
  },

  // `jsr:` specs publish as `npm:@jsr/std__jsonc@…`, which exists only on npm.jsr.io, so a
  // default-registry consumer cannot install it. Inlining the parser (a leaf, no runtime
  // imports) keeps the published artifact free of any `@jsr` dep. Dropping this line
  // reintroduces an uninstallable release — verified by packing and installing the tarball.
  noExternal: ['@std/jsonc'],
  // Stale chunks are published: `dist/` is what ships, and a chunk left from an
  // earlier build stays in the tarball. This package shipped a megabyte of
  // bundled test-runner internals that way, long after the code that pulled
  // them in was gone.
  clean: true,
  // In-source `if (import.meta.vitest)` blocks are test code. Defining the flag
  // away makes every such branch statically dead, so rolldown drops it along with
  // its dynamic `import('vitest')`. Without this the blocks ship, including those
  // bundled from a workspace dependency's sources.
  define: { 'import.meta.vitest': 'undefined' },
})
