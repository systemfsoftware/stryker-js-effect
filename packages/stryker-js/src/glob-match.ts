import { globToRegExp } from '@std/path/posix/glob-to-regexp'
import { isGlob as pathIsGlob } from '@std/path/posix/is-glob'

const GLOB = { extended: true, globstar: true } as const

export const isGlob = pathIsGlob

export const matchesGlob = (path: string, pattern: string, caseInsensitive = false): boolean =>
  globToRegExp(pattern, { ...GLOB, caseInsensitive }).test(path)

export type IgnoreRule = {
  readonly negate: boolean
  readonly matches: (candidate: string) => boolean
  readonly matchesPrefix: (candidate: string) => boolean
}

export const compileIgnoreRule = (pattern: string): IgnoreRule => {
  const negate = pattern.startsWith('!')
  const glob = negate ? pattern.slice(1) : pattern
  const re = globToRegExp(glob, { ...GLOB, caseInsensitive: true })
  const prefix = new RegExp(re.source.replace(/\$$/, ''), re.flags)
  return {
    negate,
    matches: (candidate: string) => re.test(candidate),
    matchesPrefix: (candidate: string) => prefix.test(candidate),
  }
}
