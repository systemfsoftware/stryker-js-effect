import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { RequestAffectedFilesCommand } from '../CheckerCommands.schema.js'
import { AffectedFilesRequested, requestAffectedFiles } from '../request-affected-files.workflow.js'

const decide = <A>(result: Result.Result<A, never>): A =>
  Result.match(result, { onFailure: (refused) => refused, onSuccess: (decision) => decision })

const decisionFor = (presentFileNames: ReadonlyArray<string>, affectedFileNames: ReadonlyArray<string>) =>
  decide(
    requestAffectedFiles(
      RequestAffectedFilesCommand.make({
        affectedFileNames: [...affectedFileNames],
        presentFileNames: [...presentFileNames],
      }),
    ),
  )

const requestedFor = (presentFileNames: ReadonlyArray<string>, affectedFileNames: ReadonlyArray<string>) => {
  const decision = decisionFor(presentFileNames, affectedFileNames)
  return S.is(AffectedFilesRequested)(decision) ? decision.fileNames : []
}

const requestsAnyFile = (presentFileNames: ReadonlyArray<string>, affectedFileNames: ReadonlyArray<string>) =>
  S.is(AffectedFilesRequested)(decisionFor(presentFileNames, affectedFileNames))

describe('requestAffectedFiles', (it) => {
  it.prop(
    '∀files_Requested_⊆Present∩Affected',
    { of: [S.Array(S.String), S.Array(S.String)], subject: requestedFor },
    (subject, [presentFileNames, affectedFileNames]) =>
      Arr.every(
        subject(presentFileNames, affectedFileNames),
        (fileName) => presentFileNames.includes(fileName) && affectedFileNames.includes(fileName),
      ),
  )

  it.prop(
    '∀files_Requested_⊇DistinctAffected',
    { of: [S.Array(S.String), S.Array(S.String)], subject: requestedFor },
    (subject, [presentFileNames, affectedFileNames]) => {
      const requested = subject(presentFileNames, affectedFileNames)
      return Arr.every(
        Arr.dedupe(Arr.filter(presentFileNames, (fileName) => affectedFileNames.includes(fileName))),
        (fileName) => requested.includes(fileName),
      )
    },
  )

  it.prop(
    '∀files_Request_≡VariantByIntersection',
    { of: [S.Array(S.String), S.Array(S.String)], subject: requestsAnyFile },
    (subject, [presentFileNames, affectedFileNames]) =>
      subject(presentFileNames, affectedFileNames) ===
        Arr.some(presentFileNames, (fileName) => affectedFileNames.includes(fileName)),
  )
})
