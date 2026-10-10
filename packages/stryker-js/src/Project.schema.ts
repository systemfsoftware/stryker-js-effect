import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import * as Arr from 'effect/Array'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export const ProjectFile = S.Struct({
  name: S.String,
  mutate: Instrument.MutateDescriptionSchema,
  content: S.UndefinedOr(S.String),
  originalContent: S.UndefinedOr(S.String),
})

export type ProjectFile = typeof ProjectFile.Type

export interface Project {
  readonly fileDescriptions: Instrument.FileDescriptions
  readonly testFiles: readonly string[]
  readonly files: ReadonlyMap<string, ProjectFile>
  readonly filesToMutate: ReadonlyMap<string, ProjectFile>
}

const replacedBy = (
  files: ReadonlyMap<string, ProjectFile>,
  updates: ReadonlyArray<ProjectFile>,
): ReadonlyMap<string, ProjectFile> =>
  new Map([...files, ...Arr.map(updates, (update) => [update.name, update] as const)])

const heldIn = (files: ReadonlyMap<string, ProjectFile>) => (update: ProjectFile): boolean => files.has(update.name)

export const withPreprocessedFiles: {
  (updates: ReadonlyArray<ProjectFile>): (project: Project) => Project
  (project: Project, updates: ReadonlyArray<ProjectFile>): Project
} = dual(2, (project: Project, updates: ReadonlyArray<ProjectFile>): Project => ({
  ...project,
  files: replacedBy(project.files, updates),
  filesToMutate: replacedBy(project.filesToMutate, Arr.filter(updates, heldIn(project.filesToMutate))),
}))

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const DrawnFiles = S.Array(S.Tuple([ProjectFile, S.Boolean])).pipe(S.check(S.isMaxLength(12)))
  const ExistingUpdate = S.Tuple([S.Int, S.UndefinedOr(S.String)])
  const DrawnUpdates = S.Array(S.Union([ExistingUpdate, ProjectFile])).pipe(S.check(S.isMaxLength(12)))

  type Entries = ReadonlyArray<readonly [string, ProjectFile]>

  const projectOf = (drawn: typeof DrawnFiles.Type): Project => {
    const unique = Arr.dedupeWith(drawn, ([left], [right]) => left.name === right.name)
    return {
      fileDescriptions: {},
      testFiles: [],
      files: new Map(Arr.map(unique, ([file]) => [file.name, file] as const)),
      filesToMutate: new Map(
        Arr.map(Arr.filter(unique, ([, mutated]) => mutated), ([file]) => [file.name, file] as const),
      ),
    }
  }

  const existingUpdateOf = (existing: Entries, [index, content]: typeof ExistingUpdate.Type) =>
    Option.map(
      Arr.get(existing, Math.abs(index) % Math.max(existing.length, 1)),
      ([, file]): ProjectFile => ({ ...file, content }),
    )

  const updatesOf = (existing: Entries, drawn: typeof DrawnUpdates.Type): ReadonlyArray<ProjectFile> =>
    Arr.getSomes(
      Arr.map(drawn, (update) =>
        Option.orElse(
          Option.liftPredicate(update, S.is(ProjectFile)),
          () =>
            Option.flatMap(Option.liftPredicate(update, S.is(ExistingUpdate)), (at) => existingUpdateOf(existing, at)),
        )),
    )

  const lastUpdateOf = (updates: ReadonlyArray<ProjectFile>, name: string): Option.Option<ProjectFile> =>
    Arr.findLast(updates, (update) => update.name === name)

  const replacedIn = (before: Entries, updates: ReadonlyArray<ProjectFile>): Entries =>
    Arr.map(before, ([name, file]) => [name, Option.getOrElse(lastUpdateOf(updates, name), () => file)] as const)

  const addedTo = (before: Entries, updates: ReadonlyArray<ProjectFile>): Entries =>
    Arr.getSomes(
      Arr.map(
        Arr.dedupe(
          Arr.filter(Arr.map(updates, (update) => update.name), (name) => !before.some(([held]) => held === name)),
        ),
        (name) => Option.map(lastUpdateOf(updates, name), (file) => [name, file] as const),
      ),
    )

  const sameEntries = (map: ReadonlyMap<string, ProjectFile>, expected: Entries): boolean => {
    const actual = [...map]
    return actual.length === expected.length &&
      Arr.every(
        Arr.zip(actual, expected),
        ([[name, file], [expectedName, expectedFile]]) => name === expectedName && file === expectedFile,
      )
  }

  it.prop(
    '∀pu_PreprocessedFiles_≡FreshMapsLastUpdateWinsUnknownNamesJoinFilesOnly',
    { of: [DrawnFiles, DrawnUpdates], subject: withPreprocessedFiles },
    (subject, [files, drawnUpdates]) => {
      const project = projectOf(files)
      const filesBefore: Entries = [...project.files]
      const mutateBefore: Entries = [...project.filesToMutate]
      const updates = updatesOf(filesBefore, drawnUpdates)
      const merged = subject(project, updates)
      return Arr.every(
        [
          sameEntries(project.files, filesBefore),
          sameEntries(project.filesToMutate, mutateBefore),
          merged.files !== project.files,
          merged.filesToMutate !== project.filesToMutate,
          sameEntries(merged.files, [...replacedIn(filesBefore, updates), ...addedTo(filesBefore, updates)]),
          sameEntries(merged.filesToMutate, replacedIn(mutateBefore, updates)),
        ],
        (holds) => holds,
      )
    },
  )
}
