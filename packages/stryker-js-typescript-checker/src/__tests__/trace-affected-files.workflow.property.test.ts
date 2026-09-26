import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as HashSet from 'effect/HashSet'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { TraceAffectedFilesCommand } from '../CheckerCommands.schema.js'
import { DependentFileAffected, MutatedFileAffected, traceAffectedFiles } from '../trace-affected-files.workflow.js'

const FILE_INDEX_LIMIT = 4

const indexSchema = () => S.Int.check(S.isBetween({ minimum: 0, maximum: FILE_INDEX_LIMIT }))
const edgesSchema = () => S.Array(S.Tuple([indexSchema(), indexSchema()])).check(S.isMaxLength(6))
const fileIndexesSchema = () => S.Array(indexSchema()).check(S.isMaxLength(6))

const fileNameOf = (index: number) => `src/file-${index}.ts`

const importsByFileOf = (edges: ReadonlyArray<readonly [number, number]>): Record<string, ReadonlyArray<string>> => {
  const size = 1 + Arr.reduce(edges, 0, (largest, [child, parent]) => Math.max(largest, child, parent))
  return Object.fromEntries(
    Arr.map(Arr.range(0, size - 1), (index) => [
      fileNameOf(index),
      Arr.map(Arr.filter(edges, ([, parent]) => parent === index), ([child]) => fileNameOf(child)),
    ]),
  )
}

const decide = <A>(result: Result.Result<A, never>): A =>
  Result.match(result, { onFailure: (refused) => refused, onSuccess: (decision) => decision })

const eventsFor = (edges: ReadonlyArray<readonly [number, number]>, fileIndexes: ReadonlyArray<number>) =>
  decide(
    traceAffectedFiles(
      TraceAffectedFilesCommand.make({
        importsByFile: importsByFileOf(edges),
        mutatedFileNames: Arr.map(fileIndexes, fileNameOf),
      }),
    ),
  )

const affectedFor = (edges: ReadonlyArray<readonly [number, number]>, fileIndexes: ReadonlyArray<number>) =>
  Arr.map(eventsFor(edges, fileIndexes), (event) => event.fileName).sort()

const propagateDependents = (
  affected: ReadonlySet<string>,
  [child, parent]: readonly [number, number],
): ReadonlySet<string> => affected.has(fileNameOf(child)) ? new Set([...affected, fileNameOf(parent)]) : affected

const expectedAffected = (
  edges: ReadonlyArray<readonly [number, number]>,
  mutatedFileNames: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const seed: ReadonlySet<string> = new Set(mutatedFileNames)
  return [
    ...Arr.reduce(Arr.range(0, edges.length + 1), seed, (affected) => Arr.reduce(edges, affected, propagateDependents)),
  ].sort()
}

describe('traceAffectedFiles', (it) => {
  it.prop(
    '∀graph_Mutants_≡AffectedDependents',
    { of: [edgesSchema(), fileIndexesSchema()], subject: affectedFor },
    (subject, [edges, fileIndexes]) =>
      Equal.equals(subject(edges, fileIndexes), expectedAffected(edges, Arr.map(fileIndexes, fileNameOf))),
  )

  it.prop(
    '∀graph_Mutants_⊆Affected',
    { of: [edgesSchema(), fileIndexesSchema()], subject: affectedFor },
    (subject, [edges, fileIndexes]) => {
      const affected = subject(edges, fileIndexes)
      return Arr.every(Arr.map(fileIndexes, fileNameOf), (fileName) => affected.includes(fileName))
    },
  )

  it.prop(
    '∀graph_Mutants_⊆Files∪Mutants',
    { of: [edgesSchema(), fileIndexesSchema()], subject: affectedFor },
    (subject, [edges, fileIndexes]) => {
      const known = new Set([
        ...Arr.map(Arr.range(0, FILE_INDEX_LIMIT), fileNameOf),
        ...Arr.map(fileIndexes, fileNameOf),
      ])
      return Arr.every(subject(edges, fileIndexes), (fileName) => known.has(fileName))
    },
  )

  it.prop(
    '∀graph_Mutants_≡SeedAndDependentTags',
    { of: [edgesSchema(), fileIndexesSchema()], subject: eventsFor },
    (subject, [edges, fileIndexes]) => {
      const seeds = HashSet.fromIterable(Arr.map(fileIndexes, fileNameOf))
      const events = subject(edges, fileIndexes)
      return (
        Equal.equals(
          Arr.map(events, (event) => event.fileName).sort(),
          expectedAffected(edges, Arr.map(fileIndexes, fileNameOf)),
        ) &&
        Arr.every(
          events,
          (event) =>
            Equal.equals(S.is(MutatedFileAffected)(event), HashSet.has(seeds, event.fileName)) &&
            Equal.equals(S.is(DependentFileAffected)(event), !HashSet.has(seeds, event.fileName)),
        )
      )
    },
  )
})
