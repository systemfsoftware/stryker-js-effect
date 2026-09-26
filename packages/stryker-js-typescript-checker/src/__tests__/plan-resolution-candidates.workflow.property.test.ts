import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PlanResolutionCandidatesCommand } from '../CheckerCommands.schema.js'
import { ExtensionlessPath, planResolutionCandidates } from '../plan-resolution-candidates.workflow.js'

const decisionFor = (command: PlanResolutionCandidatesCommand) =>
  Result.match(planResolutionCandidates(command), {
    onFailure: (refused) => refused,
    onSuccess: (value) => value,
  })

const candidatesFor = (command: PlanResolutionCandidatesCommand): ReadonlyArray<string> =>
  decisionFor(command).candidates

describe('planResolutionCandidates', (it) => {
  it.prop(
    '∀command_ExtensionPresence_≡ExtensionlessVariant',
    {
      of: [PlanResolutionCandidatesCommand],
      subject: (command: PlanResolutionCandidatesCommand) => decisionFor(command),
    },
    (subject, [command]) => Equal.equals(S.is(ExtensionlessPath)(subject(command)), command.extension === ''),
  )

  it.prop(
    '∀command_Candidates_≡ResolvedFirst',
    { of: [PlanResolutionCandidatesCommand], subject: candidatesFor },
    (subject, [command]) => Equal.equals(Arr.head(subject(command)), Option.some(command.resolved)),
  )
})
