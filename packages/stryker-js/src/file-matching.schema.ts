import * as Match from 'effect/Match'
import type * as Path from 'effect/Path'
import * as Boolean from 'effect/Boolean'
import * as S from 'effect/Schema'

const GLOB_META = /[*?[{]/

export const isGlob = (value: string) => GLOB_META.test(value)

const escapeRegex = (value: string) => value.replace(/[\\^$.|()+]/g, '\\$&')

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
    Boolean.match(caseInsensitive, { onTrue: () => 'i', onFalse: () => '' }),
  )

export const matchesGlob = dual<
  (pattern: string, caseInsensitive?: boolean) => (path: string) => boolean,
  (path: string, pattern: string, caseInsensitive?: boolean) => boolean
>(
  (args) => typeof args[1] === 'string',
  (path, pattern, caseInsensitive = false) => globToRegExp(pattern, caseInsensitive).test(path),
)

export const compileIgnoreRule = (pattern: string) => {
  const negate = pattern.startsWith('!')
  const glob = Boolean.match(negate, {
    onTrue: () => pattern.slice(1),
    onFalse: () => pattern,
  })
  const re = globToRegExp(glob, true)
  const prefix = new RegExp(re.source.replace(/\$$/, ''), re.flags)
  return {
    negate,
    matches: (candidate: string) => re.test(candidate),
    matchesPrefix: (candidate: string) => prefix.test(candidate),
  }
}
const DEFAULT_GLOB = '**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}'

const normalizeFileName = (fileName: string): string => fileName.replace(/\\/g, '/')

export const createFileMatcher = dual<
  (
    pathService: Path.Path,
    allowHiddenFiles?: boolean,
  ) => (pattern: boolean | string) => (fileName: string) => boolean,
  (
    pattern: boolean | string,
    pathService: Path.Path,
    allowHiddenFiles?: boolean,
  ) => (fileName: string) => boolean
>(
  (args) => (args.length === 2 ? typeof args[1] !== 'boolean' : args.length >= 3),
  (pattern, pathService, allowHiddenFiles = true) =>
    (fileName: string) =>
      matchesGlob(normalizeFileName(pathService.resolve(fileName)))(
        Match.value(pattern).pipe(
          Match.when(Match.string, (value) => normalizeFileName(pathService.resolve(value))),
          Match.when(true, () => DEFAULT_GLOB),
          Match.orElse(() => false),
        ),
      ),
)

export const matchesFile = dual<
  (
    fileName: string,
    pathService: Path.Path,
    allowHiddenFiles?: boolean,
  ) => (pattern: boolean | string) => boolean,
  (
    pattern: boolean | string,
    fileName: string,
    pathService: Path.Path,
    allowHiddenFiles?: boolean,
  ) => boolean
>(
  (args) => (args.length === 3 ? typeof args[2] !== 'boolean' : args.length === 4),
  (pattern, fileName, pathService, allowHiddenFiles = true) =>
    createFileMatcher(pattern, pathService, allowHiddenFiles)(fileName),
)
