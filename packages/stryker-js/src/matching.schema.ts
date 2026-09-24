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

  matches(candidate: string): boolean {
    return globToRegExp(this.pattern, true).test(candidate)
  }

  matchesPrefix(candidate: string): boolean {
    const expression = globToRegExp(this.pattern, true)
    return new RegExp(expression.source.replace(/\$$/, ''), expression.flags).test(candidate)
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
