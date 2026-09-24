import { Boolean } from 'effect'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

const DEFAULT_GLOB = '**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}'

const normalizeFileNameOf = (fileName: string) => fileName.replace(/\\/g, '/')

const normalizePatternOf = (pattern: boolean | string, pathService: Path.Path): boolean | string =>
  Match.value(pattern).pipe(
    Match.when(Match.string, (value) => normalizeFileNameOf(pathService.resolve(value))),
    Match.when(true, () => DEFAULT_GLOB),
    Match.orElse(() => false),
  )

const escapeRegex = (value: string) => value.replace(/[\\^$.|()+]/g, '\\$&')

const globSegmentToRegex = (segment: string) =>
  Boolean.match(segment.length === 0, {
    onTrue: () => '',
    onFalse: () => {
      const char = segment[0] ?? ''
      const rest = segment.slice(1)
      return Match.value(char).pipe(
        Match.when('*', () =>
          Boolean.match(rest.startsWith('*'), {
            onTrue: () => {
              const afterStars = rest.slice(1)
              return Boolean.match(afterStars.startsWith('/'), {
                onTrue: () => `(?:(?:[^/]+/)*)?${globSegmentToRegex(afterStars.slice(1))}`,
                onFalse: () => `.*${globSegmentToRegex(afterStars)}`,
              })
            },
            onFalse: () => `[^/]*${globSegmentToRegex(rest)}`,
          })),
        Match.when('?', () => `[^/]${globSegmentToRegex(rest)}`),
        Match.when('{', () => {
          const close = segment.indexOf('}')
          return Boolean.match(close < 0, {
            onTrue: () => `${escapeRegex(char)}${globSegmentToRegex(rest)}`,
            onFalse: () => {
              const alternatives = segment.slice(1, close).split(',').map(globSegmentToRegex).join('|')
              return `(?:${alternatives})${globSegmentToRegex(segment.slice(close + 1))}`
            },
          })
        }),
        Match.when('[', () => {
          const close = segment.indexOf(']', 1)
          return Boolean.match(close < 0, {
            onTrue: () => `${escapeRegex(char)}${globSegmentToRegex(rest)}`,
            onFalse: () => `${segment.slice(0, close + 1)}${globSegmentToRegex(segment.slice(close + 1))}`,
          })
        }),
        Match.orElse((plain) => `${escapeRegex(plain)}${globSegmentToRegex(rest)}`),
      )
    },
  })

const globToRegExp = (pattern: string, caseInsensitive: boolean) =>
  new RegExp(
    `^${globSegmentToRegex(pattern)}$`,
    Boolean.match(caseInsensitive, { onTrue: () => 'i', onFalse: () => '' }),
  )

const matchesGlob = (path: string, pattern: string) => globToRegExp(pattern, false).test(path)

export class FileMatcher extends S.Class<FileMatcher>('FileMatcher')({
  pattern: S.Union([S.Boolean, S.String]),
  allowHiddenFiles: S.Boolean,
}) {
  matches(pathService: Path.Path, fileName: string): boolean {
    const path = normalizeFileNameOf(pathService.resolve(fileName))
    return Match.value(normalizePatternOf(this.pattern, pathService)).pipe(
      Match.when(Match.string, (normalized) =>
        Boolean.match(
          this.allowHiddenFiles || !path.split('/').some((entry) => entry.startsWith('.')),
          {
            onTrue: () => matchesGlob(path, normalized),
            onFalse: () => false,
          },
        )),
      Match.orElse(() => false),
    )
  }
}

export class IgnoreRule extends S.Class<IgnoreRule>('IgnoreRule')({
  negate: S.Boolean,
  expression: S.instanceOf(RegExp),
  prefixExpression: S.instanceOf(RegExp),
}) {
  matches(candidate: string): boolean {
    return this.expression.test(candidate)
  }

  matchesPrefix(candidate: string): boolean {
    return this.prefixExpression.test(candidate)
  }
}

const ignoreRuleOf = (pattern: string) => {
  const negate = pattern.startsWith('!')
  const expression = globToRegExp(
    Boolean.match(negate, { onTrue: () => pattern.slice(1), onFalse: () => pattern }),
    true,
  )
  return IgnoreRule.make({
    negate,
    expression,
    prefixExpression: new RegExp(expression.source.replace(/\$$/, ''), expression.flags),
  })
}

export const IgnoreRuleFromPattern = S.String.pipe(
  S.decodeTo(IgnoreRule, {
    decode: SGetter.transform(ignoreRuleOf),
    encode: SGetter.forbiddenEncoding,
  }),
)

const relativeNormalizedFileNameOf = (input: { readonly fileName: string | undefined; readonly basePath: string }) => {
  const raw = input.fileName ?? ''
  return Boolean.match(raw.startsWith(input.basePath), {
    onTrue: () => raw.slice(input.basePath.length).replace(/^\/+/, ''),
    onFalse: () => raw,
  }).replace(/\\/g, '/')
}

export const RelativeNormalizedFileName = S.Struct({
  fileName: S.UndefinedOr(S.String),
  basePath: S.String,
}).pipe(
  S.decodeTo(S.String, {
    decode: SGetter.transform(relativeNormalizedFileNameOf),
    encode: SGetter.forbiddenEncoding,
  }),
)
