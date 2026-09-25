import { Boolean } from 'effect'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

const DEFAULT_GLOB = '**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}'

const normalizeFileNameOf = (fileName: string) => fileName.replace(/\\/g, '/')

const normalizePatternOf = (pattern: boolean | string, pathService: Path.Path): boolean | string =>
  Match.value(pattern).pipe(
    Match.withReturnType<boolean | string>(),
    Match.when(Match.string, (value) => normalizeFileNameOf(pathService.resolve(value))),
    Match.when(true, () => DEFAULT_GLOB),
    Match.orElse(() => false),
  )

const escapeRegex = (value: string): string => value.replace(/[\\^$.|()+]/g, '\\$&')

const globSegmentToRegex = (segment: string): string =>
  Match.value(segment.length === 0).pipe(
    Match.withReturnType<string>(),
    Match.when(true, () => ''),
    Match.orElse(() =>
      Match.value(segment.charCodeAt(0) - 42).pipe(
        Match.withReturnType<string>(),
        Match.when(0, () => {
          const rest = segment.slice(1)
          return Boolean.match(rest.startsWith('*'), {
            onTrue: () => {
              const afterStars = rest.slice(1)
              return Boolean.match(afterStars.startsWith('/'), {
                onTrue: () => `(?:(?:[^/]+/)*)?${globSegmentToRegex(afterStars.slice(1))}`,
                onFalse: () => `.*${globSegmentToRegex(afterStars)}`,
              })
            },
            onFalse: () => `[^/]*${globSegmentToRegex(rest)}`,
          })
        }),
        Match.when(21, () => `[^/]${globSegmentToRegex(segment.slice(1))}`),
        Match.when(81, () => {
          const close = segment.indexOf('}')
          return Boolean.match(close < 0, {
            onTrue: () => `${escapeRegex('{')}${globSegmentToRegex(segment.slice(1))}`,
            onFalse: () => {
              const alternatives = segment.slice(1, close).split(',').map(globSegmentToRegex).join('|')
              return `(?:${alternatives})${globSegmentToRegex(segment.slice(close + 1))}`
            },
          })
        }),
        Match.when(49, () => {
          const close = segment.indexOf(']', 1)
          return Boolean.match(close < 0, {
            onTrue: () => `${escapeRegex('[')}${globSegmentToRegex(segment.slice(1))}`,
            onFalse: () => `${segment.slice(0, close + 1)}${globSegmentToRegex(segment.slice(close + 1))}`,
          })
        }),
        Match.orElse(() => `${escapeRegex(segment[0] ?? '')}${globSegmentToRegex(segment.slice(1))}`),
      )
    ),
  )

const globToRegExp = (pattern: string, caseInsensitive: boolean) =>
  new RegExp(
    `^${globSegmentToRegex(pattern)}$`,
    Boolean.match(caseInsensitive, { onTrue: (): 'i' => 'i', onFalse: (): '' => '' }),
  )
const matchesGlob = (path: string, pattern: string) => globToRegExp(pattern, false).test(path)
const compileIgnorePattern = (pattern: string) => {
  const expression = globToRegExp(pattern, true)
  return { expression, prefix: new RegExp(expression.source.replace(/\$$/, ''), expression.flags) }
}

export class FileMatcher extends S.Class<FileMatcher>('FileMatcher')({
  pattern: S.Union([S.Boolean, S.String]),
  allowHiddenFiles: S.Boolean,
}) {
  matches(pathService: Path.Path, fileName: string): boolean {
    const path = normalizeFileNameOf(pathService.resolve(fileName))
    return Match.value(normalizePatternOf(this.pattern, pathService)).pipe(
      Match.withReturnType<boolean>(),
      Match.when(Match.string, (normalized) =>
        Boolean.match(this.allowHiddenFiles, {
          onTrue: () => matchesGlob(path, normalized),
          onFalse: () =>
            Boolean.match(path.split('/').some((entry) => entry.startsWith('.')), {
              onTrue: () => false,
              onFalse: () => matchesGlob(path, normalized),
            }),
        })),
      Match.orElse(() => false),
    )
  }
}
export class IgnoreRule extends S.Class<IgnoreRule>('IgnoreRule')({
  negate: S.Boolean,
  pattern: S.String,
}) {
  static readonly fromPattern = (pattern: string) =>
    Boolean.match(pattern.startsWith('!'), {
      onTrue: () => IgnoreRule.make({ negate: true, pattern: pattern.slice(1) }),
      onFalse: () => IgnoreRule.make({ negate: false, pattern }),
    })

  #compiled: { readonly expression: RegExp; readonly prefix: RegExp } | undefined

  #compiledRule() {
    return this.#compiled ??= compileIgnorePattern(this.pattern)
  }

  matches(candidate: string): boolean {
    return this.#compiledRule().expression.test(candidate)
  }

  matchesPrefix(candidate: string): boolean {
    return this.#compiledRule().prefix.test(candidate)
  }
}

export class RelativeNormalizedFileName extends S.Class<RelativeNormalizedFileName>('RelativeNormalizedFileName')({
  fileName: S.String,
}) {
  static readonly fromAbsolute = (fileName: string | undefined, basePath: string) => {
    const raw = fileName ?? ''
    return RelativeNormalizedFileName.make({
      fileName: Boolean.match(raw.startsWith(basePath), {
        onTrue: () => raw.slice(basePath.length).replace(/^\/+/, ''),
        onFalse: () => raw,
      }).replace(/\\/g, '/'),
    })
  }
}

const matcherOf = (pattern: boolean | string): FileMatcher => FileMatcher.make({ pattern, allowHiddenFiles: true })

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const { Arbitrary } = await import('effect/unstable/arbitrary')
  const Effect = await import('effect/Effect')

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

  it.prop(
    '∀p_File_≡LiteralMatchesItself',
    { of: [proseArb], subject: matcherOf },
    (subject, [literal]) => subject(literal).matches(pathServiceOf(), literal),
  )

  it.prop(
    '∀p_Path_≡FalsePatternRefuses',
    { of: [pathArb], subject: matcherOf },
    (subject, [fileName]) => subject(false).matches(pathServiceOf(), fileName) === false,
  )

  it.prop(
    '∀pe_Extension_≡TruePatternMatchesListedExtension',
    { of: [strictSegmentArb, proseArb], subject: matcherOf },
    (subject, [segment, extension]) => {
      const matcher = subject(true)
      const pathService = pathServiceOf()
      const extensionsOf = (path: string) => path.split('.').slice(1)
      return matcher.matches(pathService, `/x/y/${segment}.${extension}`) ===
        extensionsOf(`/x/y/${segment}.${extension}`).some((present) =>
          ['js', 'ts', 'jsx', 'tsx', 'html', 'vue', 'mjs', 'mts', 'cts', 'cjs'].includes(present)
        )
    },
  )

  it.prop(
    '∀ps_Span_≡StarStarSpansSegmentsStarDoesNot',
    { of: [strictSegmentArb], subject: matcherOf },
    (subject, [segment]) => {
      const pathService = pathServiceOf()
      const star = subject(`/x/*/${segment}`)
      const starStar = subject(`/x/**/${segment}`)
      return starStar.matches(pathService, `/x/y/z/${segment}`) &&
        star.matches(pathService, `/x/y/z/${segment}`) === false
    },
  )

  const flagsFlipAsNegated = (include: IgnoreRule, exclude: IgnoreRule): boolean =>
    include.negate === false && exclude.negate === true

  const matchesAgree = (include: IgnoreRule, exclude: IgnoreRule, candidate: string): boolean =>
    include.matches(candidate) === exclude.matches(candidate)

  it.prop(
    '∀p_Rule_≡NegationFlipsOnlyTheFlag',
    { of: [strictSegmentArb], subject: IgnoreRule.fromPattern },
    (subject, [segment]) => {
      const include = subject(`**/${segment}.ts`)
      const exclude = subject(`!**/${segment}.ts`)
      return flagsFlipAsNegated(include, exclude) && matchesAgree(include, exclude, `/x/${segment}.ts`)
    },
  )

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
    { of: [strictSegmentArb, basePathArb], subject: RelativeNormalizedFileName.fromAbsolute },
    (subject, [segment, basePath]) => subject(`${basePath}//${segment}.ts`, basePath).fileName === `${segment}.ts`,
  )

  it.prop(
    '∀fb_ForeignPath_=SurvivesUnchanged',
    { of: [strictSegmentArb, basePathArb], subject: RelativeNormalizedFileName.fromAbsolute },
    (subject, [segment, basePath]) => {
      const foreign = `/elsewhere/${segment}.ts`
      return subject(foreign, basePath).fileName === foreign
    },
  )
}
