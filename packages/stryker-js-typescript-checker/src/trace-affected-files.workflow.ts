import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { TraceAffectedFilesCommand } from './CheckerCommands.schema.js'

const TraceTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/TraceAffectedFiles')
type TraceTypeId = typeof TraceTypeId

export class MutatedFileAffected extends S.TaggedClass<MutatedFileAffected>()('MutatedFileAffected', {
  fileName: S.String,
}) {
  readonly [TraceTypeId] = TraceTypeId
}

export class DependentFileAffected extends S.TaggedClass<DependentFileAffected>()('DependentFileAffected', {
  fileName: S.String,
}) {
  readonly [TraceTypeId] = TraceTypeId
}

export const AffectedFiles = S.Array(S.Union([MutatedFileAffected, DependentFileAffected]))
export type AffectedFiles = typeof AffectedFiles.Type

type Dependents = HashMap.HashMap<string, HashSet.HashSet<string>>

const dependentsOf = (importsByFile: Readonly<Record<string, ReadonlyArray<string>>>): Dependents =>
  Arr.reduce(
    Object.entries(importsByFile),
    HashMap.empty<string, HashSet.HashSet<string>>(),
    (dependents, [fileName, imports]) =>
      Arr.reduce(
        imports,
        dependents,
        (accumulated, imported) =>
          HashMap.set(
            accumulated,
            imported,
            HashSet.add(
              Option.getOrElse(HashMap.get(accumulated, imported), () => HashSet.empty<string>()),
              fileName,
            ),
          ),
      ),
  )

const dependentsOfFile = (dependents: Dependents, fileName: string): HashSet.HashSet<string> =>
  Option.getOrElse(HashMap.get(dependents, fileName), () => HashSet.empty<string>())

const closeOverDependents = (dependents: Dependents, affected: HashSet.HashSet<string>): HashSet.HashSet<string> => {
  const grown = HashSet.union(
    affected,
    HashSet.fromIterable(
      Arr.flatMap(Arr.fromIterable(affected), (fileName) => Arr.fromIterable(dependentsOfFile(dependents, fileName))),
    ),
  )
  return Boolean.match(HashSet.size(grown) === HashSet.size(affected), {
    onTrue: () => grown,
    onFalse: () => closeOverDependents(dependents, grown),
  })
}

const affectedEvents = (seed: HashSet.HashSet<string>, affected: HashSet.HashSet<string>): AffectedFiles =>
  Arr.map(Arr.fromIterable(affected), (fileName) =>
    Boolean.match(HashSet.has(seed, fileName), {
      onTrue: () => MutatedFileAffected.make({ fileName }),
      onFalse: () => DependentFileAffected.make({ fileName }),
    }))

const decide = (command: TraceAffectedFilesCommand): Result.Result<AffectedFiles, never> => {
  const seed = HashSet.fromIterable(command.mutatedFileNames)
  return Result.succeed(affectedEvents(seed, closeOverDependents(dependentsOf(command.importsByFile), seed)))
}

export const traceAffectedFiles = Workflow.make({
  command: TraceAffectedFilesCommand,
  decision: AffectedFiles,
  error: S.Never,
  decide,
})
