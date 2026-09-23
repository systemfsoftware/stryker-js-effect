import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { dual } from 'effect/Function'

import { toRelativeNormalizedFileName } from './IncrementalDiff.paths.js'

export const survivorMutateSpans: {
  (survivors: readonly Mutant[], basePath: string): string[]
  (basePath: string): (survivors: readonly Mutant[]) => string[]
} = dual(
  2,
  (survivors: readonly Mutant[], basePath: string): string[] => [
    ...new Set(
      survivors.map((survivor) =>
        `${toRelativeNormalizedFileName(survivor.fileName, basePath)}:${
          survivor.location.start.line + 1
        }:${survivor.location.start.column}-${survivor.location.end.line + 1}:${survivor.location.end.column}`
      ),
    ),
  ],
)
