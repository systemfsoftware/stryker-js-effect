import { describe, it } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const BASELINE_SRC = '/tmp/refactor/baseline/packages/stryker-js/src'
const BASELINE_DIST = '/tmp/refactor/baseline/packages/stryker-js/dist/index.mjs'

const pathService = Effect.runSync(
  Effect.provide(
    Effect.gen(function*() {
      return yield* Path.Path
    }),
    Path.layer,
  ),
)

describe('scratch baseline import', () => {
  it('loads every baseline matching surface', async () => {
    const dist = await import(pathToFileURL(BASELINE_DIST).href)
    const globMatch = await import(pathToFileURL(`${BASELINE_SRC}/glob-match.ts`).href)
    const incrementalPaths = await import(pathToFileURL(`${BASELINE_SRC}/IncrementalDiff.paths.ts`).href)
    const fileMatching = await import(pathToFileURL(`${BASELINE_SRC}/file-matching.ts`).href)
    const matcher = dist.createFileMatcher('src/**/*.ts', pathService)
    const rule = globMatch.compileIgnoreRule('!**/*.spec.ts')
    console.log(
      JSON.stringify({
        distKeys: Object.keys(dist),
        globKeys: Object.keys(globMatch),
        matcher: matcher('/a/b/src/x.ts'),
        matchesFile: dist.matchesFile('src/**/*.ts', '/a/b/src/x.ts', pathService),
        relative: dist.toRelativeNormalizedFileName('/repo/src/x.ts', '/repo'),
        ruleNegate: rule.negate,
        ruleMatches: rule.matches('a/b/x.spec.ts'),
        rulePrefix: rule.matchesPrefix('a/b'),
        sourceFileMatchingWorks: fileMatching.createFileMatcher('src/**/*.ts', pathService)('/q/src/y.ts'),
        incrementalSource: incrementalPaths.toRelativeNormalizedFileName('/repo/src/x.ts', '/repo'),
        pathResolve: pathService.resolve('src/x.ts'),
      }),
    )
  })
})