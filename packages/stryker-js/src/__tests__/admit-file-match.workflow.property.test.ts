import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { admitFileMatch, FileMatchCommand, FileMatched } from '../admit-file-match.workflow.js'
import { RelativeNormalizedFileName } from '../matching.schema.js'

const LISTED_EXTENSIONS = ['js', 'ts', 'jsx', 'tsx', 'html', 'vue', 'mjs', 'mts', 'cts', 'cjs'] as const
const DEFAULT_GLOB = '**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}'

const segmentArb = Arbitrary.schema(S.String.check(S.isPattern(/^[a-z][a-z0-9]{0,5}$/)))

const pathArb = Arbitrary.array(segmentArb, { minLength: 1, maxLength: 4 }).pipe(
  Arbitrary.map((segments) => `/${segments.join('/')}`),
)

const listedExtensionArb = Arbitrary.schema(S.Literals(LISTED_EXTENSIONS))

const unlistedExtensionArb = Arbitrary.schema(S.Literals(['md', 'json', 'txt', 'css']))

const baseSegmentArb = Arbitrary.schema(S.String.check(S.isPattern(/^[a-z][a-z0-9]{0,4}$/)))

const basePathArb = Arbitrary.schema(S.String.check(S.isPattern(/^\/base(\/[a-z]{1,4}){0,2}$/)))

const matched = (result: ReturnType<typeof admitFileMatch>): boolean =>
  Result.isSuccess(result) && S.is(FileMatched)(result.success)

const command = (resolvedPattern: boolean | string, allowHiddenFiles: boolean, resolvedFileName: string) =>
  FileMatchCommand.make({ resolvedPattern, allowHiddenFiles, resolvedFileName })

describe('admitFileMatch', () => {
  it.prop(
    '∀p_LiteralPath_≡MatchesItself',
    { of: [pathArb], subject: admitFileMatch },
    (subject, [path]) => matched(subject(command(path, true, path))),
  )

  it.prop(
    '∀p_PathRefused_≡FalsePattern',
    { of: [pathArb], subject: admitFileMatch },
    (subject, [path]) => !matched(subject(command(false, true, path))),
  )

  it.prop(
    '∀be_Extension_≡ListedExtensionMatchesResolvedDefaultGlob',
    { of: [Arbitrary.all({ base: baseSegmentArb, extension: listedExtensionArb })], subject: admitFileMatch },
    (subject, [draw]) =>
      matched(subject(command(`/${draw.base}/${DEFAULT_GLOB}`, true, `/${draw.base}/a.${draw.extension}`))),
  )

  it.prop(
    '∀be_Extension_≡UnlistedExtensionIsRefusedByResolvedDefaultGlob',
    { of: [Arbitrary.all({ base: baseSegmentArb, extension: unlistedExtensionArb })], subject: admitFileMatch },
    (subject, [draw]) =>
      !matched(subject(command(`/${draw.base}/${DEFAULT_GLOB}`, true, `/${draw.base}/a.${draw.extension}`))),
  )

  it.prop(
    '∀ps_Span_≡StarStarSpansSegmentsStarDoesNot',
    { of: [segmentArb], subject: admitFileMatch },
    (subject, [segment]) => {
      const candidate = `/x/y/z/${segment}.ts`
      const star = matched(subject(command(`/x/*/${segment}.ts`, true, candidate)))
      const starStar = matched(subject(command(`/x/**/${segment}.ts`, true, candidate)))
      return starStar && star === false
    },
  )

  it.prop(
    '∀fp_HiddenFile_≡RefusedWhenNotAllowed',
    { of: [pathArb, segmentArb], subject: admitFileMatch },
    (subject, [path, segment]) => {
      const candidate = `/x/.${segment}${path}.ts`
      const allowed = matched(subject(command('/x/**/*.ts', true, candidate)))
      const refused = matched(subject(command('/x/**/*.ts', false, candidate)))
      return allowed && refused === false
    },
  )
})

describe('RelativeNormalizedFileName.fromAbsolute', () => {
  it.prop(
    '∀fb_Strip_=IsIdempotent',
    { of: [pathArb, basePathArb], subject: RelativeNormalizedFileName.fromAbsolute },
    (subject, [fileName, basePath]) => {
      const first = subject(fileName, basePath).fileName
      const second = subject(first, basePath).fileName
      return first === second
    },
  )

  it.prop(
    '∀fb_Strip_=RemovesBasePrefixAndLeadingSlashes',
    { of: [segmentArb, basePathArb], subject: RelativeNormalizedFileName.fromAbsolute },
    (subject, [segment, basePath]) => subject(`${basePath}//${segment}.ts`, basePath).fileName === `${segment}.ts`,
  )

  it.prop(
    '∀fb_ForeignPath_=SurvivesUnchanged',
    { of: [segmentArb, basePathArb], subject: RelativeNormalizedFileName.fromAbsolute },
    (subject, [segment, basePath]) => {
      const foreign = `/elsewhere/${segment}.ts`
      return subject(foreign, basePath).fileName === foreign
    },
  )
})
