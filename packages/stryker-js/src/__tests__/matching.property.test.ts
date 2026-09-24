import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
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

const TOKEN_AT = [
  '**',
  '*',
  '?',
  '[a-z]',
  '{a,b}',
  'src',
  '.hidden',
  'spec',
  '[!',
  '{',
  '/',
] as const

const patternTokenArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 10 }))).pipe(
  Arbitrary.map((index) => TOKEN_AT[index] ?? '*'),
)

const proseArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 11 }))).pipe(
  Arbitrary.map((index) => PROSE_TOKENS[index] ?? 'a'),
)

const strictSegmentArb = Arbitrary.array(proseArb, { minLength: 1, maxLength: 3 }).pipe(
  Arbitrary.map((tokens) => tokens.join('')),
)

const pathArb = Arbitrary.array(visibleSegmentArb, { minLength: 1, maxLength: 6 }).pipe(
  Arbitrary.map((segments) => `/${segments.join('/')}`),
)

const patternArb = Arbitrary.array(patternTokenArb, { minLength: 1, maxLength: 5 }).pipe(
  Arbitrary.map((tokens) => tokens.join('/')),
)

const fileNameArb = Arbitrary.schema(S.String)

const basePathArb = Arbitrary.schema(S.String.check(S.isPattern(/^\/base(\/[a-z]{1,4}){0,2}$/)))

describe('FileMatcher', () => {
  it.prop('∀p_File_LiteralMatchesItself', [proseArb], ([literal]) => {
    const matcher = FileMatcher.make({ pattern: literal, allowHiddenFiles: true })
    return matcher.matches(pathServiceOf(), literal)
  })

  it.prop('∀p_Path_FalsePatternRefuses', [pathArb], ([fileName]) =>
    FileMatcher.make({ pattern: false, allowHiddenFiles: true }).matches(pathServiceOf(), fileName) === false
  )

  it.prop('∀pe_Extension_TruePatternMatchesListedExtension', [strictSegmentArb, proseArb], ([segment, extension]) => {
    const matcher = FileMatcher.make({ pattern: true, allowHiddenFiles: true })
    const pathService = pathServiceOf()
    const extensionsOf = (path: string) => path.split('.').slice(1)
    return matcher.matches(pathService, `/x/y/${segment}.${extension}`) ===
      extensionsOf(`/x/y/${segment}.${extension}`).some((present) =>
        ['js', 'ts', 'jsx', 'tsx', 'html', 'vue', 'mjs', 'mts', 'cts', 'cjs'].includes(present))
  })
})

describe('IgnoreRule', () => {
  it.prop('∀p_Rule_NegationFlipsOnlyTheFlag', [strictSegmentArb], ([segment]) => {
    const include = Effect.runSync(IgnoreRule.decode(`**/${segment}.ts`))
    const exclude = Effect.runSync(IgnoreRule.decode(`!**/${segment}.ts`))
    return include.negate === false && exclude.negate === true &&
      include.matches(`/x/${segment}.ts`) === exclude.matches(`/x/${segment}.ts`)
  })

  it.prop('∀p_Rule_MatchRefusesOtherExtensions', [strictSegmentArb], ([segment]) => {
    const rule = Effect.runSync(IgnoreRule.decode(`**/${segment}.ts`))
    return rule.matches(`/x/${segment}.ts`) && rule.matches(`/x/${segment}.md`) === false
  })

  it.prop('∀p_Rule_UnbalancedBracketStaysLiteral', [strictSegmentArb], ([segment]) => {
  it.prop('∀pe_Suffix_SuffixPatternConservesItsSuffix', [proseArb, proseArb], ([stem, suffix]) => {
    const pathService = pathServiceOf()
    const suffixPattern = FileMatcher.make({ pattern: `**/*.${suffix}`, allowHiddenFiles: true })
    return (
      suffixPattern.matches(pathService, `/x/${stem}.${suffix}`) &&
      suffixPattern.matches(pathService, `/x/${stem}.${suffix === 'md' ? 'ts' : 'md'}`) === false
    )
  })
})

describe('RelativeNormalizedFileName', () => {
  it.prop('∀fb_Strip_IsIdempotent', [pathArb, basePathArb], ([fileName, basePath]) => {
    const first = Effect.runSync(S.decodeEffect(RelativeNormalizedFileName)({ fileName, basePath }))
    const second = Effect.runSync(S.decodeEffect(RelativeNormalizedFileName)({ fileName: first, basePath }))
    return first === second
  })

  it.prop('∀fb_Strip_RemovesBasePrefixAndLeadingSlashes', [plainSegmentArb, basePathArb], ([segment, basePath]) => {
    const stripped = Effect.runSync(
      S.decodeEffect(RelativeNormalizedFileName)({ fileName: `${basePath}//${segment}.ts`, basePath }),
    )
    return stripped === `${segment}.ts`
  })

  it.prop('∀fb_ForeignPath_SurvivesUnchanged', [plainSegmentArb, basePathArb], ([segment, basePath]) => {
    const foreign = `/elsewhere/${segment}.ts`
    return Effect.runSync(S.decodeEffect(RelativeNormalizedFileName)({ fileName: foreign, basePath })) === foreign
  })

  it.prop('∀fb_Codec_ForbidsEncoding', [pathArb, basePathArb], ([fileName, basePath]) => {
    const decoded = Effect.runSync(S.decodeEffect(RelativeNormalizedFileName)({ fileName, basePath }))
    return Result.isFailure(S.encodeResult(RelativeNormalizedFileName)(decoded))
  })
})
