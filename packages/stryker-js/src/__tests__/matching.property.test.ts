import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { FileMatcher, IgnoreRule, RelativeNormalizedFileName } from '../matching.schema.js'

const pathServiceOf = (): Path.Path => Effect.runSync(Effect.provide(Path.Path, Path.layer))

const plainSegmentArb = Arbitrary.schema(S.String.check(S.isPattern(/^[a-z][a-z0-9._-]{0,7}$/)))

const hiddenSegmentArb = plainSegmentArb.pipe(Arbitrary.map((segment) => `.${segment}`))

const visibleSegmentArb = Arbitrary.schema(S.Boolean).pipe(
  Arbitrary.flatMap((hidden) => (hidden ? hiddenSegmentArb : plainSegmentArb)),
)

const PROSE_TOKENS = [
  'a',
  'src',
  'spec',
  'file',
  'test',
  'x',
  'index',
  'main',
  'util',
  'data',
  'core',
] as const

const proseArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 11 }))).pipe(
  Arbitrary.map((index) => PROSE_TOKENS[index] ?? 'a'),
)

const strictSegmentArb = Arbitrary.array(proseArb, { minLength: 1, maxLength: 3 }).pipe(
  Arbitrary.map((tokens) => tokens.join('')),
)

const pathArb = Arbitrary.array(visibleSegmentArb, { minLength: 1, maxLength: 6 }).pipe(
  Arbitrary.map((segments) => `/${segments.join('/')}`),
)

const basePathArb = Arbitrary.schema(S.String.check(S.isPattern(/^\/base(\/[a-z]{1,4}){0,2}$/)))

describe('FileMatcher', () => {
  it.prop('∀p_File_LiteralMatchesItself', [proseArb], ([literal]) => {
    const matcher = FileMatcher.make({ pattern: literal, allowHiddenFiles: true })
    return matcher.matches(pathServiceOf(), literal)
  })

  it.prop(
    '∀p_Path_FalsePatternRefuses',
    [pathArb],
    ([fileName]) =>
      FileMatcher.make({ pattern: false, allowHiddenFiles: true }).matches(pathServiceOf(), fileName) === false,
  )

  it.prop('∀pe_Extension_TruePatternMatchesListedExtension', [strictSegmentArb, proseArb], ([segment, extension]) => {
    const matcher = FileMatcher.make({ pattern: true, allowHiddenFiles: true })
    const pathService = pathServiceOf()
    const extensionsOf = (path: string) => path.split('.').slice(1)
    return matcher.matches(pathService, `/x/y/${segment}.${extension}`) ===
      extensionsOf(`/x/y/${segment}.${extension}`).some((present) =>
        ['js', 'ts', 'jsx', 'tsx', 'html', 'vue', 'mjs', 'mts', 'cts', 'cjs'].includes(present)
      )
  })

  it.prop('∀ps_Span_StarStarSpansSegmentsStarDoesNot', [strictSegmentArb], ([segment]) => {
    const pathService = pathServiceOf()
    const star = FileMatcher.make({ pattern: `/x/*/${segment}`, allowHiddenFiles: true })
    const starStar = FileMatcher.make({ pattern: `/x/**/${segment}`, allowHiddenFiles: true })
    return starStar.matches(pathService, `/x/y/z/${segment}`) &&
      star.matches(pathService, `/x/y/z/${segment}`) === false
  })
})

describe('IgnoreRule', () => {
  it.prop('∀p_Rule_NegationFlipsOnlyTheFlag', [strictSegmentArb], ([segment]) => {
    const include = IgnoreRule.fromPattern(`**/${segment}.ts`)
    const exclude = IgnoreRule.fromPattern(`!**/${segment}.ts`)
    return include.negate === false && exclude.negate === true &&
      include.matches(`/x/${segment}.ts`) === exclude.matches(`/x/${segment}.ts`)
  })
})

describe('RelativeNormalizedFileName', () => {
  it.prop('∀fb_Strip_IsIdempotent', [pathArb, basePathArb], ([fileName, basePath]) => {
    const first = RelativeNormalizedFileName.fromAbsolute(fileName, basePath).fileName
    const second = RelativeNormalizedFileName.fromAbsolute(first, basePath).fileName
    return first === second
  })

  it.prop('∀fb_Strip_RemovesBasePrefixAndLeadingSlashes', [strictSegmentArb, basePathArb], ([segment, basePath]) => {
    const stripped = RelativeNormalizedFileName.fromAbsolute(`${basePath}//${segment}.ts`, basePath).fileName
    return stripped === `${segment}.ts`
  })

  it.prop('∀fb_ForeignPath_SurvivesUnchanged', [strictSegmentArb, basePathArb], ([segment, basePath]) => {
    const foreign = `/elsewhere/${segment}.ts`
    return RelativeNormalizedFileName.fromAbsolute(foreign, basePath).fileName === foreign
  })
})
