import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import type * as Path from 'effect/Path'

import { matchesGlob } from './glob-match.js'

const DEFAULT_GLOB = '**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}'

const normalizeFileName = (fileName: string): string => fileName.replace(/\\/g, '/')

const normalizePattern = (
  pattern: boolean | string,
  pathService: Path.Path,
): boolean | string =>
  Match.value(pattern).pipe(
    Match.when(Match.string, (value) => normalizeFileName(pathService.resolve(value))),
    Match.when(true, () => DEFAULT_GLOB),
    Match.orElse(() => false),
  )

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
    Match.value(normalizePattern(pattern, pathService)).pipe(
      Match.when(
        Match.string,
        (normalized) => (fileName: string) => {
          const path = normalizeFileName(pathService.resolve(fileName))
          const hidden = path.split('/').some((segment) => segment.startsWith('.'))
          return Match.value(allowHiddenFiles || !hidden).pipe(
            Match.when(true, () => matchesGlob(path, normalized)),
            Match.orElse(() => false),
          )
        },
      ),
      Match.orElse((normalized) => () => normalized),
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
