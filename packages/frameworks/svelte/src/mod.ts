import type { FrameworkContribution } from '@systemfsoftware/stryker-framework-interface'

import { COMPILER_SPECIFIER, contributionOf, loadPeer } from './peer.js'

export const strykerFrameworks: readonly FrameworkContribution[] = [
  await contributionOf(() => loadPeer(COMPILER_SPECIFIER)),
]
