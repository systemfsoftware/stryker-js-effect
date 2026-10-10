import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type GateEntry,
  GateInputUnusable,
  gateNewSurvivors,
  GateNewSurvivorsCommand,
} from '../gate-new-survivors.workflow.js'

const isSurvivor = (entry: GateEntry): boolean => S.is(Mutant.SurvivorStatusSchema)(entry.status)

const sortedIdsOf = (ids: ReadonlyArray<string>): ReadonlyArray<string> => Arr.sort(ids, Order.String)

const survivorIdsOf = (entries: ReadonlyArray<GateEntry>): ReadonlyArray<string> =>
  sortedIdsOf(Arr.map(Arr.filter(entries, isSurvivor), (entry) => entry.id))

const missingIdsOf = (command: GateNewSurvivorsCommand): ReadonlyArray<string> =>
  Arr.filter(survivorIdsOf(command.entries), (id) => !Arr.contains(command.committed ?? [], id))

const idTextOf = (ids: ReadonlyArray<string>): string => Arr.join(sortedIdsOf(ids), ',')

describe('gateNewSurvivors', () => {
  it.prop(
    '∀c_GateNewSurvivorsCommand_≡UpdateBaselineCommitsExactlyThisRunsSurvivors',
    { of: [GateNewSurvivorsCommand], subject: gateNewSurvivors },
    (subject, [command]) => {
      const updating = GateNewSurvivorsCommand.make({
        entries: command.entries,
        committed: command.committed,
        baselineFile: command.baselineFile,
        updateBaseline: true,
      })
      const cleared = Result.getOrThrow(subject(updating))
      return (
        cleared.baseline !== null &&
        idTextOf(cleared.baseline.survivors) === idTextOf(survivorIdsOf(command.entries))
      )
    },
  )

  it.prop(
    '∀c_GateNewSurvivorsCommand_≡GateNamesOnlySurvivorsMissingFromTheCommittedBaseline',
    { of: [GateNewSurvivorsCommand], subject: gateNewSurvivors },
    (subject, [command]) => {
      const missing = missingIdsOf(command)
      const outcome = subject(command)
      return Boolean.match(command.updateBaseline, {
        onTrue: () => Result.isSuccess(outcome),
        onFalse: () =>
          Boolean.match(command.committed === null, {
            onTrue: () =>
              Result.match(outcome, {
                onSuccess: () => false,
                onFailure: (failure) => S.is(GateInputUnusable)(failure),
              }),
            onFalse: () =>
              Result.match(outcome, {
                onSuccess: (cleared) => Arr.length(missing) === 0 && cleared.baseline === null,
                onFailure: (failure) =>
                  Match.value(failure).pipe(
                    Match.tag('GateRejected', (rejected) => {
                      const named = Arr.map(rejected.newSurvivors, (entry) => entry.id)
                      return (
                        Arr.length(missing) > 0 &&
                        Arr.every(named, (id) => Arr.contains(missing, id)) &&
                        idTextOf(named) === idTextOf(missing)
                      )
                    }),
                    Match.tag('GateInputUnusable', () => false),
                    Match.exhaustive,
                  ),
              }),
          }),
      })
    },
  )
})
