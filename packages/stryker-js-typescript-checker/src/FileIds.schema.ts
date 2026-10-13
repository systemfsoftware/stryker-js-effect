import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

const FileIdsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/FileIds')
type FileIdsTypeId = typeof FileIdsTypeId

export const FileMutant = S.Struct({
  fileName: S.String,
  id: Mutant.MutantId,
})
export type FileMutant = typeof FileMutant.Type

export const FileMutants = S.Array(FileMutant)
export type FileMutants = typeof FileMutants.Type

export class FileIds extends S.TaggedClass<FileIds>()('FileIds', {
  fileName: S.String,
  ids: S.NonEmptyArray(Mutant.MutantId),
}) {
  readonly [FileIdsTypeId] = FileIdsTypeId
}

export const FileIdsList = S.Array(FileIds)
export type FileIdsList = typeof FileIdsList.Type
interface Grouping {
  readonly files: ReadonlyArray<string>
  readonly idsByFile: HashMap.HashMap<string, Arr.NonEmptyReadonlyArray<Mutant.MutantId>>
}

const emptyGrouping: Grouping = { files: [], idsByFile: HashMap.empty() }

const adding = (grouping: Grouping, mutant: FileMutant): Grouping =>
  Option.match(HashMap.get(grouping.idsByFile, mutant.fileName), {
    onNone: () => ({
      files: [...grouping.files, mutant.fileName],
      idsByFile: HashMap.set(grouping.idsByFile, mutant.fileName, [mutant.id]),
    }),
    onSome: (ids) => ({
      ...grouping,
      idsByFile: HashMap.set(grouping.idsByFile, mutant.fileName, Arr.append(ids, mutant.id)),
    }),
  })

export const fileIdsOf = (mutants: FileMutants): FileIdsList => {
  const grouping = Arr.reduce(mutants, emptyGrouping, adding)
  return Arr.getSomes(
    Arr.map(
      grouping.files,
      (fileName) => Option.map(HashMap.get(grouping.idsByFile, fileName), (ids) => FileIds.make({ fileName, ids })),
    ),
  )
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const PooledFileMutant = S.Struct({
    fileName: S.Literals(['a.ts', 'b.ts', 'c.ts']),
    id: Mutant.MutantId,
  })

  const sameIds = Arr.makeEquivalence(S.toEquivalence(Mutant.MutantId))

  it.prop(
    '∀m_FileIdsOf_≡FilesInFirstSeenOrderEachHoldingItsIdsInInputOrder',
    { of: [S.Array(PooledFileMutant)], subject: fileIdsOf },
    (subject, [mutants]) => {
      const grouped = subject(mutants)
      const firstSeen = Arr.dedupe(Arr.map(mutants, (mutant) => mutant.fileName))
      return Arr.makeEquivalence(S.toEquivalence(S.String))(Arr.map(grouped, (file) => file.fileName), firstSeen) &&
        Arr.every(grouped, (file) =>
          sameIds(
            file.ids,
            Arr.map(Arr.filter(mutants, (mutant) => mutant.fileName === file.fileName), (mutant) => mutant.id),
          ))
    },
  )
}
