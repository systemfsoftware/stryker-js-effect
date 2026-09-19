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

export function createFileMatcher(
  pattern: boolean | string,
  pathService: Path.Path,
  allowHiddenFiles = true,
): (fileName: string) => boolean {
  return Match.value(normalizePattern(pattern, pathService)).pipe(
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
  )
}

export function matchesFile(
  pattern: boolean | string,
  fileName: string,
  pathService: Path.Path,
  allowHiddenFiles = true,
): boolean {
  return createFileMatcher(pattern, pathService, allowHiddenFiles)(fileName)
}
