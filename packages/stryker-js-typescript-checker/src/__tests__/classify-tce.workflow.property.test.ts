import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'

import { classifyTce, ClassifyTceCommand, type TceDecision } from '../classify-tce.workflow.js'

const decisionsOf = (command: ClassifyTceCommand): ReadonlyArray<TceDecision> =>
  Result.match(classifyTce(command), { onFailure: () => [], onSuccess: (decision) => decision })

const matchesEarlierSibling = (command: ClassifyTceCommand, index: number): boolean => {
  const candidate = command.candidates[index]
  return candidate === undefined
    ? false
    : Arr.some(
      Arr.take(command.candidates, index),
      (earlier) => earlier.site === candidate.site && earlier.emit === candidate.emit,
    )
}

describe('classifyTce', (it) => {
  it.prop(
    '∀command_ClassifiedEmit_≡OriginalOrEarlierSibling',
    { of: [ClassifyTceCommand], subject: decisionsOf },
    (subject, [command]) => {
      const decisions = subject(command)
      return Arr.every(decisions, (decision) => {
        const index = command.candidates.findIndex((candidate) => candidate.id === decision.id)
        const candidate = command.candidates[index]
        if (candidate === undefined) return false
        return decision.classification === 'original'
          ? candidate.emit === command.originalEmit
          : matchesEarlierSibling(command, index)
      })
    },
  )

  it.prop(
    '∀command_KeptCandidate_≡DistinctFromOriginalAndEarlierSiblings',
    { of: [ClassifyTceCommand], subject: decisionsOf },
    (subject, [command]) => {
      const decisions = subject(command)
      const classifiedIds = new Set(decisions.map((decision) => decision.id))
      return Arr.every(command.candidates, (candidate, index) => {
        if (classifiedIds.has(candidate.id)) return true
        return candidate.emit !== command.originalEmit && !matchesEarlierSibling(command, index)
      })
    },
  )
})
