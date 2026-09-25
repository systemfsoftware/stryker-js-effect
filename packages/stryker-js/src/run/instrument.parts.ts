import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import { absurd } from 'effect/Function'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'

import type { Project, ProjectFile } from '../Project.schema.js'
import type { SkippedFileRow } from '../run-event.schema.js'
import { RunEvents, SkippedReported } from '../run-events.service.js'
import { explainFileSkip, ExplainFileSkipCommand, type FrameworkClaimant } from './explain-file-skip.workflow.js'
import type { PrepareDone } from './prepare.cell.js'

export const offerSkipsIfAny = (input: {
  readonly skipped: readonly Instrument.InstrumentFileSkip[]
  readonly claimants: readonly FrameworkClaimant[]
}) =>
  Boolean.match(input.skipped.length === 0, {
    onTrue: () => Effect.void,
    onFalse: () =>
      Effect.gen(function*() {
        const files = input.skipped.map((skip) =>
          Result.match(
            explainFileSkip(
              ExplainFileSkipCommand.make({ extension: skip.extension, claimants: [...input.claimants] }),
            ),
            {
              onFailure: absurd<SkippedFileRow>,
              onSuccess: (explained): SkippedFileRow => ({
                file: skip.file,
                extension: skip.extension,
                reason: explained.reason,
              }),
            },
          )
        )
        const queue = yield* RunEvents
        yield* Queue.offer(queue, SkippedReported.make({ files }))
      }),
  })

export const sandboxDirectoriesOf = (input: { readonly command: PrepareDone; readonly basePath: string }) =>
  Boolean.match(input.command.options.inPlace, {
    onTrue: () => ({ workingDirectory: input.basePath, backupDirectory: input.command.temporaryDirectoryPath }),
    onFalse: () => ({ workingDirectory: input.command.temporaryDirectoryPath, backupDirectory: '' }),
  })

export const mergeInstrumentedFile = (input: { readonly project: Project; readonly file: ProjectFile }): Project => {
  const files = MutableHashMap.fromIterable(input.project.files)
  MutableHashMap.set(files, input.file.name, input.file)
  const filesToMutate = MutableHashMap.fromIterable(input.project.filesToMutate)
  Boolean.match(input.file.mutate !== false, {
    onTrue: () => MutableHashMap.set(filesToMutate, input.file.name, input.file),
    onFalse: () => MutableHashMap.remove(filesToMutate, input.file.name),
  })
  return { ...input.project, files, filesToMutate }
}
