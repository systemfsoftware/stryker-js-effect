import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Order from 'effect/Order'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { RunIdentityRead, RunIdentitySource, RunIdentityUndecodable } from './run-path.schema.js'

export class ReadRunIdentityCommand extends S.TaggedClass<ReadRunIdentityCommand>()('ReadRunIdentityCommand', {
  file: S.NonEmptyString,
  text: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const decodeSource = S.decodeResult(S.fromJsonString(RunIdentitySource))

const identityOf = (source: RunIdentitySource): RunIdentityRead =>
  RunIdentityRead.make({
    projectRoot: source.projectRoot,
    runInputsDigest: source.runInputsDigest,
    mutantIds: Arr.sort(
      Arr.flatMap(Record.values(source.files), (file) => Arr.map(file.mutants, (mutant) => mutant.id)),
      Order.String,
    ),
  })

const decide = (command: ReadRunIdentityCommand): Result.Result<RunIdentityRead, RunIdentityUndecodable> =>
  Result.match(decodeSource(command.text), {
    onFailure: (error) => Result.fail(RunIdentityUndecodable.make({ file: command.file, reason: error.message })),
    onSuccess: (source) => Result.succeed(identityOf(source)),
  })

export const readRunIdentity = Workflow.make({
  command: ReadRunIdentityCommand,
  decision: RunIdentityRead,
  error: RunIdentityUndecodable,
  decide,
})
