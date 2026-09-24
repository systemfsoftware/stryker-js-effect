import type { FrameworkContribution } from '@systemfsoftware/stryker-framework-interface'

import { angularFramework } from './html-format.js'

export const strykerFrameworks: readonly FrameworkContribution[] = [angularFramework]
