import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  CheckerMutantFromMutant,
  DescribeCheckerMutantsCommand,
  MutantDescribed,
  MutantDescription,
  MutantUndescribable,
  UndescribableMutant,
} from './Checker.schema.js'

type DescriptionCandidate = DescribeCheckerMutantsCommand['candidates'][number]

const decodeWire = S.decodeUnknownResult(CheckerMutantFromMutant)

const describe = (candidate: DescriptionCandidate): MutantDescription =>
  Result.match(decodeWire(candidate.mutant), {
    onSuccess: (wire) => MutantDescribed.make({ wire }),
    onFailure: (error) =>
      MutantUndescribable.make({
        undescribable: UndescribableMutant.make({
          id: candidate.id,
          fileName: candidate.fileName,
          reason: error.message,
        }),
      }),
  })

const decide = (
  command: DescribeCheckerMutantsCommand,
): Result.Result<readonly MutantDescription[], never> => Result.succeed(command.candidates.map(describe))

export const describeCheckerMutants = Workflow.make({
  command: DescribeCheckerMutantsCommand,
  decision: S.Array(MutantDescription),
  error: S.Never,
  decide,
})
