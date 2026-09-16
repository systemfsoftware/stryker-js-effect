import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { FastCheck as fc } from 'effect/testing'

import {
  planWorkerEntry,
  WorkerEntryCommand,
  WorkerEntryFromBin,
  WorkerEntryFromWorkerExport,
  WorkerEntryMissing,
} from '../plan-worker-entry.workflow.js'

const commandArbitrary = S.toArbitrary(WorkerEntryCommand)(fc)

const declaresNothing = (command: WorkerEntryCommand): boolean =>
  command.bin === undefined && command.workerExport === undefined

const namesItsSpecifier = (failure: WorkerEntryMissing, command: WorkerEntryCommand): boolean =>
  failure.pluginName === command.pluginName && failure.specifier === command.modulePath

describe('planWorkerEntry', () => {
  it.prop('∀c_Entry_≡Declaration', [commandArbitrary], ([command]) => {
    const result = planWorkerEntry(command)
    return Result.match(result, {
      onFailure: () => declaresNothing(command),
      onSuccess: (decision) => {
        if (S.is(WorkerEntryFromBin)(decision)) {
          return command.bin !== undefined && decision.relativeEntrypoint === command.bin
        }
        return command.workerExport !== undefined && decision.relativeEntrypoint === command.workerExport
      },
    })
  })

  it.prop('∀c_Entry_≡Refusal', [commandArbitrary], ([command]) => {
    const result = planWorkerEntry(command)
    if (declaresNothing(command)) {
      return Result.isFailure(result) && S.is(WorkerEntryMissing)(result.failure) &&
        namesItsSpecifier(result.failure, command)
    }
    return Result.isSuccess(result)
  })

  it.prop('∀c_Entry_→WorkerExportWins', [commandArbitrary], ([command]) => {
    const result = planWorkerEntry(command)
    return Result.match(result, {
      onFailure: () => declaresNothing(command),
      onSuccess: (decision) => {
        if (S.is(WorkerEntryFromWorkerExport)(decision)) {
          return decision.relativeEntrypoint === command.workerExport
        }
        return decision.relativeEntrypoint === command.bin && command.workerExport === undefined
      },
    })
  })
})
