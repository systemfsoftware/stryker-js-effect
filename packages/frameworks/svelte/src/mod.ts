import type { FrameworkContribution } from '@systemfsoftware/stryker-framework-interface'

import { frameworkContribution } from './compiler-resolution.js'

const COMPILER_SPECIFIER = 'svelte/compiler'
const WALKER_SPECIFIER = 'oxc-walker'

const loadModule = (specifier: string): Promise<unknown> => import(specifier)

export const strykerFrameworks: readonly FrameworkContribution[] = [
  await frameworkContribution(
    () => loadModule(COMPILER_SPECIFIER),
    () => loadModule(WALKER_SPECIFIER),
  ),
]
