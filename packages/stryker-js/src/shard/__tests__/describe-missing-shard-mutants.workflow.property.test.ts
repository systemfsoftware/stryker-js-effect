import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  describeMissingShardMutants,
  DescribeMissingShardMutantsCommand,
} from '../describe-missing-shard-mutants.workflow.js'

const MISSING_IDS_NAMED = 5

describe('describeMissingShardMutants', () => {
  it.prop(
    '∀ids_MissingIds_≡NamesAtMostFiveInOrderAndCountsTheRest',
    { of: [S.Array(S.String)], subject: describeMissingShardMutants },
    (subject, [missingIds]) => {
      const text = Result.getOrElse(
        subject(DescribeMissingShardMutantsCommand.make({ missingIds })),
        (neverError) => neverError,
      ).text
      const named = missingIds.slice(0, MISSING_IDS_NAMED).join(', ')
      const rest = missingIds.length - MISSING_IDS_NAMED
      const expected = rest > 0 ? `${named}, +${rest} more` : named
      return text === expected
    },
  )
})
