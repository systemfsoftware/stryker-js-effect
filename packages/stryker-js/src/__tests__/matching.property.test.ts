import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { FileMatcher, IgnoreRule, RelativeNormalizedFileName } from '../matching.schema.js'

interface BaselineIgnoreRule {
  readonly negate: boolean
  readonly matches: (candidate: string) => boolean
  readonly matchesPrefix: (candidate: string) => boolean
}

interface BaselineMatching {
  readonly createFileMatcher: (
    pattern: boolean | string,
    pathService: Path.Path,
    allowHiddenFiles?: boolean,
  ) => (fileName: string) => boolean
  readonly matchesFile: (
    pattern: boolean | string,
    fileName: string,
    pathService: Path.Path,
    allowHiddenFiles?: boolean,
  ) => boolean
  readonly toRelativeNormalizedFileName: (fileName: string | undefined, basePath: string) => string
  readonly compileIgnoreRule: (pattern: string) => BaselineIgnoreRule
}

const BASELINE_SOURCE_DIR = '/tmp/refactor/baseline/packages/stryker-js/src'
const BASELINE_DIST_PATH = '/tmp/refactor/baseline/packages/stryker-js/dist/index.mjs'

const baselinePresent = existsSync(`${BASELINE_SOURCE_DIR}/glob-match.ts`) && existsSync(BASELINE_DIST_PATH)

const baselineMatchingOf = async (): Promise<BaselineMatching> => {
  const globMatch = await import(pathToFileURL(`${BASELINE_SOURCE_DIR}/glob-match.ts`).href)
  const dist = await import(pathToFileURL(BASELINE_DIST_PATH).href)
  return {
    createFileMatcher: dist.createFileMatcher,
    matchesFile: dist.matchesFile,
    toRelativeNormalizedFileName: dist.toRelativeNormalizedFileName,
    compileIgnoreRule: globMatch.compileIgnoreRule,
  }
}

const pathServiceOf = () =>
  Effect.runSync(
    Effect.provide(
      Effect.gen(function*() {
        return yield* Path.Path
      }),
      Path.layer,
    ),
  )

const plainSegmentArb = Arbitrary.schema(
  S.String.check(S.isPattern(/^[a-z][a-z0-9._-]{0,7}$/)),
)

const hiddenSegmentArb = plainSegmentArb.pipe(Arbitrary.map((segment) => `.${segment}`))

const visibleSegmentArb = Arbitrary.schema(S.Boolean).pipe(
  Arbitrary.flatMap((hidden) => (hidden ? hiddenSegmentArb : plainSegmentArb)),
)

const pathArb = Arbitrary.array(visibleSegmentArb, { minLength: 1, maxLength: 6 }).pipe(
  Arbitrary.map((segments) => segments.join('/')),
)

const patternTokenArb = S.Literals(['*', '**', '?', '.hidden', '/x', '{a,b}', '[a-z]', 'src', 'spec', '!neg', 'a/b'])

const patternArb = Arbitrary.array(patternTokenArb, { minLength: 1, maxLength: 5 }).pipe(
  Arbitrary.map((tokens) => tokens.join('/')),
)

const patternOrBooleanArb = Arbitrary.schema(S.Boolean).pipe(
  Arbitrary.flatMap((usePattern) => (usePattern ? patternArb : Arbitrary.schema(S.Boolean))),
)

const fileNameArb = Arbitrary.schema(S.Union([S.Undefined, S.String]))

const basePathArb = Arbitrary.schema(S.String.check(S.isPattern(/^\/base(\/[a-z]{1,4}){0,2}$/)))

describe.skipIf(!baselinePresent)('matching old-vs-new', () => {
  it.prop(
    '∀fpn_FileMatcher_≡PreRefactorCreateFileMatcher',
    [pathArb, patternOrBooleanArb, Arbitrary.schema(S.Boolean)],
    async ([fileName, pattern, allowHiddenFiles]) => {
      const baseline = await baselineMatchingOf()
      const pathService = pathServiceOf()
      const expected = baseline.createFileMatcher(pattern, pathService, allowHiddenFiles)(fileName)
      const actual = FileMatcher.make({ pattern, allowHiddenFiles }).matches(pathService, fileName)
      return actual === expected
    },
  )

  it.prop(
    '∀fpn_MatchesFile_≡PreRefactorMatchesFile',
    [patternOrBooleanArb, pathArb, Arbitrary.schema(S.Boolean)],
    async ([pattern, fileName, allowHiddenFiles]) => {
      const baseline = await baselineMatchingOf()
      const pathService = pathServiceOf()
      const expected = baseline.matchesFile(pattern, fileName, pathService, allowHiddenFiles)
      const actual = FileMatcher.make({ pattern, allowHiddenFiles }).matches(pathService, fileName)
      return actual === expected
    },
  )

  it.prop('∀pat_IgnoreRule_≡PreRefactorCompileIgnoreRule', [patternArb, pathArb], async ([pattern, candidate]) => {
    const baseline = await baselineMatchingOf()
    const expected = baseline.compileIgnoreRule(pattern)
    const actual = Effect.runSync(IgnoreRule.decode(pattern))
    return expected.negate === actual.negate && expected.matches(candidate) === actual.matches(candidate) &&
      expected.matchesPrefix(candidate) === actual.matchesPrefix(candidate)
  })

  it.prop(
    '∀fnbp_RelativeNormalizedFileName_≡PreRefactorToRelativeNormalizedFileName',
    [fileNameArb, basePathArb],
    async ([fileName, basePath]) => {
      const baseline = await baselineMatchingOf()
      const expected = baseline.toRelativeNormalizedFileName(fileName, basePath)
      return Result.match(S.decodeResult(RelativeNormalizedFileName)({ fileName, basePath }), {
        onFailure: () => false,
        onSuccess: (actual) => actual === expected,
      })
    },
  )

  it.prop(
    '∀fnbp_RelativeNormalizedFileName_ForbidsEncoding',
    [fileNameArb, basePathArb],
    async ([fileName, basePath]) => {
      const baseline = await baselineMatchingOf()
      const decoded = baseline.toRelativeNormalizedFileName(fileName, basePath)
      return Result.isFailure(S.encodeResult(RelativeNormalizedFileName)(decoded))
    },
  )
})
