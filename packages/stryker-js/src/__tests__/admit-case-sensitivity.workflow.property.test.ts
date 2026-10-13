import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { admitCaseSensitivity, CaseSensitivityCommand } from '../admit-case-sensitivity.workflow.js'

const commandArb = Arbitrary.schema(CaseSensitivityCommand)

type Probe = CaseSensitivityCommand['probes'][number]

const reachesAnotherFile = (probe: Probe) => {
  if (Option.isNone(probe.swapped)) return true
  const swapped = probe.swapped.value
  if (swapped.dev !== probe.own.dev) return true
  return Option.isSome(probe.own.ino) && Option.isSome(swapped.ino) && probe.own.ino.value !== swapped.ino.value
}

describe('admitCaseSensitivity', () => {
  it.prop(
    '∀c_Probes_≡ToldApartExactlyWhenOneSwappedNameReachesAnotherFile',
    { of: [commandArb], subject: admitCaseSensitivity },
    (subject, [command]) =>
      Result.getOrUndefined(subject(command))?._tag ===
        (command.probes.some(reachesAnotherFile) ? 'CaseToldApart' : 'CaseFolded'),
  )
})
