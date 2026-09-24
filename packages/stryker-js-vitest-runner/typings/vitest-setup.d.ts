import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'

/**
 * Types the context `inject()` reads in `stryker-setup.ts` and the task metadata
 * the report hooks write. Kept in a `.d.ts` so the augmentation is ambient,
 * matching how vitest itself declares `ProvidedContext`.
 */
declare module 'vitest' {
  interface ProvidedContext {
    globalNamespace: '__stryker__' | '__stryker2__'
    hitLimit: number | undefined
    mutantActivation: Mutant.MutantActivation
    activeMutant: string | undefined
    mode: 'mutant' | 'dry-run'
  }
  interface TaskMeta {
    hitCount: number | undefined
    mutantCoverage: Mutant.MutantCoverage | undefined
  }
}
