import { dual } from 'effect/Function'
import * as Match from 'effect/Match'

const GLOB_META = /[*?[{]/

export const isGlob = (value: string): boolean => GLOB_META.test(value)

const escapeRegex = (value: string): string => value.replace(/[\\^$.|()+]/g, '\\$&')

const globSegmentToRegex = (segment: string): string =>
  Match.value(segment.length === 0).pipe(
    Match.when(true, () => ''),
    Match.orElse(() => {
      const char = segment[0] ?? ''
      const rest = segment.slice(1)
      return Match.value(char).pipe(
        Match.when('*', () =>
          Match.value(rest.startsWith('*')).pipe(
            Match.when(true, () => {
              const afterStars = rest.slice(1)
              return Match.value(afterStars.startsWith('/')).pipe(
                Match.when(true, () => `(?:(?:[^/]+/)*)?${globSegmentToRegex(afterStars.slice(1))}`),
                Match.orElse(() => `.*${globSegmentToRegex(afterStars)}`),
              )
            }),
            Match.orElse(() => `[^/]*${globSegmentToRegex(rest)}`),
          )),
        Match.when('?', () => `[^/]${globSegmentToRegex(rest)}`),
        Match.when('{', () => {
          const close = segment.indexOf('}')
          return Match.value(close < 0).pipe(
            Match.when(true, () => `${escapeRegex(char)}${globSegmentToRegex(rest)}`),
            Match.orElse(() => {
              const inner = segment.slice(1, close)
              const after = segment.slice(close + 1)
              const alt = inner.split(',').map(globSegmentToRegex).join('|')
              return `(?:${alt})${globSegmentToRegex(after)}`
            }),
          )
        }),
        Match.when('[', () => {
          const close = segment.indexOf(']', 1)
          return Match.value(close < 0).pipe(
            Match.when(true, () => `${escapeRegex(char)}${globSegmentToRegex(rest)}`),
            Match.orElse(() => `${segment.slice(0, close + 1)}${globSegmentToRegex(segment.slice(close + 1))}`),
          )
        }),
        Match.orElse(() => `${escapeRegex(char)}${globSegmentToRegex(rest)}`),
      )
    }),
  )

const globToRegExp = (pattern: string, caseInsensitive: boolean): RegExp =>
  new RegExp(
    `^${globSegmentToRegex(pattern)}$`,
    Match.value(caseInsensitive).pipe(
      Match.when(true, () => 'i'),
      Match.orElse(() => ''),
    ),
  )

export const matchesGlob = dual<
  (pattern: string, caseInsensitive?: boolean) => (path: string) => boolean,
  (path: string, pattern: string, caseInsensitive?: boolean) => boolean
>(
  (args) => typeof args[1] === 'string',
  (path, pattern, caseInsensitive = false) => globToRegExp(pattern, caseInsensitive).test(path),
)

export type IgnoreRule = {
  readonly negate: boolean
  readonly matches: (candidate: string) => boolean
  readonly matchesPrefix: (candidate: string) => boolean
}

export const compileIgnoreRule = (pattern: string): IgnoreRule => {
  const negate = pattern.startsWith('!')
  const glob = Match.value(negate).pipe(
    Match.when(true, () => pattern.slice(1)),
    Match.orElse(() => pattern),
  )
  const re = globToRegExp(glob, true)
  const prefix = new RegExp(re.source.replace(/\$$/, ''), re.flags)
  return {
    negate,
    matches: (candidate: string) => re.test(candidate),
    matchesPrefix: (candidate: string) => prefix.test(candidate),
  }
}
