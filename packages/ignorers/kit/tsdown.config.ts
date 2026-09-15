import { defineConfig } from 'tsdown'

const CONDITION = '@systemfsoftware/source'

const toTypesPath = (mjsPath: string): string => mjsPath.replace(/\.mjs$/, '.d.ts')

const withTypesFirst = (entry: string | Record<string, string>): Record<string, string> => {
  if (typeof entry === 'string') return { types: toTypesPath(entry), default: entry }
  const ordered: Record<string, string> = {}
  if (entry[CONDITION] != null) ordered[CONDITION] = entry[CONDITION]
  ordered.types = entry.types ?? toTypesPath(entry.default)
  ordered.default = entry.default
  return ordered
}

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
  exports: {
    devExports: CONDITION,
    customExports: (exports) => {
      for (const [key, value] of Object.entries(exports)) {
        if (key === './package.json') continue
        exports[key] = withTypesFirst(value)
      }
      return exports
    },
  },
})
