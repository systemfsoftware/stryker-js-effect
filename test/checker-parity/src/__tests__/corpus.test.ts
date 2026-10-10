import { describe, it } from '@systemfsoftware/vitest'

import {
  corpusEntries,
  isE2eCheckerConfigPath,
  isWorkspaceTsconfigApp,
  programFilesFromListing,
  tscBinPath,
  tsconfigsNamedByConfig,
} from '../corpus.js'

const CHECKER_CONFIG = `export default {
  checkers: [
    { plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker') },
  ],
  tsconfigFile: 'tsconfig.json',
  mutate: ['src/**/*.ts'],
}
`

const PLAIN_CONFIG = `export default {
  testRunner: 'vitest',
  tsconfigFile: 'tsconfig.json',
}
`

describe('isWorkspaceTsconfigApp', () => {
  it('accepts a root and a nested workspace tsconfig.app.json only', function*({ expect }) {
    yield* expect([
      isWorkspaceTsconfigApp('tsconfig.app.json'),
      isWorkspaceTsconfigApp('packages/a/tsconfig.app.json'),
      isWorkspaceTsconfigApp('packages/a/tsconfig.json'),
      isWorkspaceTsconfigApp('packages/a/tsconfig.app.ts'),
    ]).toStrictEqual([true, true, false, false])
  })
})

describe('isE2eCheckerConfigPath', () => {
  it('claims only a stryker config directly under a testResources fixture', function*({ expect }) {
    yield* expect([
      isE2eCheckerConfigPath('test/e2e/testResources/calc-fixture/stryker.config.ts'),
      isE2eCheckerConfigPath('test/e2e/testResources/x/stryker.checker.config.ts'),
      isE2eCheckerConfigPath('test/e2e/testResources/x/nested/stryker.config.ts'),
      isE2eCheckerConfigPath('test/e2e/testResources/x/other.ts'),
    ]).toStrictEqual([true, true, false, false])
  })
})

describe('corpusEntries', () => {
  it('splits, dedupes and sorts the tracked corpus sources', function*({ expect }) {
    const entries = corpusEntries([
      'b/tsconfig.app.json',
      'a/tsconfig.app.json',
      'b/tsconfig.app.json',
      'test/e2e/testResources/x/stryker.config.ts',
      'test/e2e/testResources/y/stryker.config.ts',
      'README.md',
    ])
    yield* expect(entries).toStrictEqual({
      workspaceTsconfigs: ['a/tsconfig.app.json', 'b/tsconfig.app.json'],
      e2eConfigs: [
        'test/e2e/testResources/x/stryker.config.ts',
        'test/e2e/testResources/y/stryker.config.ts',
      ],
    })
  })
})

describe('tsconfigsNamedByConfig', () => {
  it('resolves the tsconfigFile of a checker-enabled configuration relative to its directory', function*({ expect }) {
    yield* expect(tsconfigsNamedByConfig(CHECKER_CONFIG, 'test/e2e/testResources/x')).toStrictEqual([
      'test/e2e/testResources/x/tsconfig.json',
    ])
  })

  it('names nothing when the configuration does not enable the checker', function*({ expect }) {
    yield* expect(tsconfigsNamedByConfig(PLAIN_CONFIG, 'test/e2e/testResources/x')).toStrictEqual([])
  })

  it('names nothing when a checker-enabled configuration has no tsconfigFile', function*({ expect }) {
    const config = `checkers: [{ plugin: '@systemfsoftware/stryker-js-typescript-checker' }]`
    yield* expect(tsconfigsNamedByConfig(config, 'test/e2e/testResources/x')).toStrictEqual([])
  })

  it.each([
    { quoted: '"tsconfig.preservation.json"', expected: 'd/tsconfig.preservation.json' },
    { quoted: '`tsconfig.extends.json`', expected: 'd/tsconfig.extends.json' },
  ])('accepts the tsconfigFile value $quoted', function*({ quoted, expected }, { expect }) {
    const config = `checkers: [{ plugin: '@systemfsoftware/stryker-js-typescript-checker' }], tsconfigFile: ${quoted}`
    yield* expect(tsconfigsNamedByConfig(config, 'd')).toStrictEqual([expected])
  })
})

describe('programFilesFromListing', () => {
  it('keeps repo sources and drops declarations, node_modules and outside-repo files', function*({ expect }) {
    const listing = [
      '/repo/node_modules/typescript/lib/lib.es2022.d.ts',
      '/repo/packages/x/src/a.ts',
      '/repo/packages/x/src/a.d.ts',
      '/repo/packages/x/src/b.d.mts',
      '/repo/packages/x/src/c.tsx',
      '/outside/other.ts',
      '',
    ].join('\n')
    yield* expect(programFilesFromListing(listing, '/repo')).toStrictEqual([
      'packages/x/src/a.ts',
      'packages/x/src/c.tsx',
    ])
  })
})

describe('tscBinPath', () => {
  it('resolves the tsc entry point from the package bin field', function*({ expect }) {
    yield* expect(tscBinPath({ bin: { tsc: './bin/tsc' } }, '/repo/node_modules/typescript/package.json')).toBe(
      '/repo/node_modules/typescript/bin/tsc',
    )
  })
})
