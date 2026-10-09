import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'

import type { VerdictComponents, VerdictEntry } from './VerdictEntry.schema.js'
import type { GetOutcome, ListOutcome, PutOutcome } from './VerdictStore.schema.js'

export interface VerdictStoreShape {
  readonly get: (components: VerdictComponents) => Effect.Effect<GetOutcome>
  readonly put: (entry: VerdictEntry) => Effect.Effect<PutOutcome>
  readonly list: (mutantId: Mutant.MutantId) => Effect.Effect<ListOutcome>
}

export class VerdictStore extends Context.Service<VerdictStore, VerdictStoreShape>()(
  '@systemfsoftware/stryker-js/verdict-store/VerdictStore.service/VerdictStore',
) {}
