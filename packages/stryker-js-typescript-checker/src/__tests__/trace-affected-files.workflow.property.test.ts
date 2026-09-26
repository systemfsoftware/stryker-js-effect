import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as HashSet from 'effect/HashSet'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { TraceAffectedFilesCommand } from '../CheckerCommands.schema.js'
import { type AffectedFiles, MutatedFileAffected, traceAffectedFiles } from '../trace-affected-files.workflow.js'

const eventsOf = (command: TraceAffectedFilesCommand): AffectedFiles =>
  Result.match(traceAffectedFiles(command), {
    onFailure: () => [],
    onSuccess: (decision) => decision,
  })

const affectedNamesOf = (command: TraceAffectedFilesCommand): ReadonlyArray<string> =>
  Arr.sort(Arr.map(eventsOf(command), (event) => event.fileName), Order.String)

const edgesOf = (
  command: TraceAffectedFilesCommand,
): ReadonlyArray<readonly [string, string]> =>
  Arr.flatMap(
    Object.entries(command.importsByFile),
    ([fileName, imports]) => Arr.map(imports, (imported): readonly [string, string] => [imported, fileName]),
  )

const referenceAffected = (command: TraceAffectedFilesCommand): ReadonlyArray<string> =>
  Arr.sort(
    Arr.fromIterable(
      Arr.reduce(
        Arr.range(0, edgesOf(command).length + 1),
        new Set(command.mutatedFileNames),
        (affected) =>
          Arr.reduce(
            edgesOf(command),
            affected,
            (current, [imported, importer]) => current.has(imported) ? new Set([...current, importer]) : current,
          ),
      ),
    ),
    Order.String,
  )

const seedOf = (command: TraceAffectedFilesCommand): HashSet.HashSet<string> =>
  HashSet.fromIterable(command.mutatedFileNames)

const tagLineOf = (fileName: string, mutated: boolean): string => `${fileName}#${mutated ? 'mutated' : 'dependent'}`

const observedTagLinesOf = (command: TraceAffectedFilesCommand): ReadonlyArray<string> =>
  Arr.sort(
    Arr.map(eventsOf(command), (event) => tagLineOf(event.fileName, S.is(MutatedFileAffected)(event))),
    Order.String,
  )

const referenceTagLinesOf = (command: TraceAffectedFilesCommand): ReadonlyArray<string> =>
  Arr.sort(
    Arr.map(referenceAffected(command), (fileName) => tagLineOf(fileName, HashSet.has(seedOf(command), fileName))),
    Order.String,
  )

describe('traceAffectedFiles', (it) => {
  it.prop(
    '∀command_Affected_≡ReferenceClosure',
    { of: [TraceAffectedFilesCommand], subject: affectedNamesOf },
    (subject, [command]) => Equal.equals(subject(command), referenceAffected(command)),
  )

  it.prop(
    '∀command_Tags_≡ReferenceTagging',
    { of: [TraceAffectedFilesCommand], subject: observedTagLinesOf },
    (subject, [command]) => Equal.equals(subject(command), referenceTagLinesOf(command)),
  )
})
