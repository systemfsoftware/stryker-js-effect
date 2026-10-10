import type { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import * as Arr from 'effect/Array'
import { dual } from 'effect/Function'

import type { IncrementalReport } from './IncrementalReport.schema.js'

export interface ProjectFile extends Instrument.FileDescription {
  readonly name: string
  readonly mutate: Instrument.MutateDescription
  readonly content: string | undefined
  readonly originalContent: string | undefined
}

export interface Project {
  readonly fileDescriptions: Instrument.FileDescriptions
  readonly incrementalReport: IncrementalReport | undefined
  readonly testFiles: readonly string[]
  readonly files: ReadonlyMap<string, ProjectFile>
  readonly filesToMutate: ReadonlyMap<string, ProjectFile>
}

const replacedBy = (
  files: ReadonlyMap<string, ProjectFile>,
  updates: ReadonlyArray<ProjectFile>,
): ReadonlyMap<string, ProjectFile> =>
  new Map([...files, ...Arr.map(updates, (update) => [update.name, update] as const)])

export const withPreprocessedFiles: {
  (updates: ReadonlyArray<ProjectFile>): (project: Project) => Project
  (project: Project, updates: ReadonlyArray<ProjectFile>): Project
} = dual(2, (project: Project, updates: ReadonlyArray<ProjectFile>): Project => ({
  ...project,
  files: replacedBy(project.files, updates),
  filesToMutate: replacedBy(
    project.filesToMutate,
    Arr.filter(updates, (update) => project.filesToMutate.has(update.name)),
  ),
}))

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const S = await import('effect/Schema')
  const Option = await import('effect/Option')

  const DrawnFile = S.Struct({
    name: S.String.pipe(S.check(S.isMaxLength(4))),
    mutate: S.Boolean,
    content: S.UndefinedOr(S.String),
    originalContent: S.UndefinedOr(S.String),
  })
  const DrawnFiles = S.Array(S.Tuple([DrawnFile, S.Boolean])).pipe(S.check(S.isMaxLength(12)))
  const DrawnUpdates = S.Array(S.Tuple([S.Int, S.UndefinedOr(S.String)])).pipe(S.check(S.isMaxLength(12)))

  const projectOf = (drawn: typeof DrawnFiles.Type): Project => {
    const unique = Arr.dedupeWith(drawn, ([left], [right]) => left.name === right.name)
    return {
      fileDescriptions: {},
      incrementalReport: undefined,
      testFiles: [],
      files: new Map(Arr.map(unique, ([file]) => [file.name, file] as const)),
      filesToMutate: new Map(
        Arr.map(Arr.filter(unique, ([, mutated]) => mutated), ([file]) => [file.name, file] as const),
      ),
    }
  }

  const updatesOf = (project: Project, drawn: typeof DrawnUpdates.Type): ReadonlyArray<ProjectFile> => {
    const existing = [...project.files.values()]
    return Arr.flatMap(
      drawn,
      ([index, content]) =>
        Option.match(Arr.get(existing, Math.abs(index) % Math.max(existing.length, 1)), {
          onNone: () => [],
          onSome: (file) => [{ ...file, content }],
        }),
    )
  }

  const expectedOf = (updates: ReadonlyArray<ProjectFile>, original: ProjectFile): ProjectFile =>
    Option.getOrElse(Arr.findLast(updates, (update) => update.name === original.name), () => original)

  const replacesExactlyTheUpdatedInPlace = (
    before: ReadonlyMap<string, ProjectFile>,
    after: ReadonlyMap<string, ProjectFile>,
    updates: ReadonlyArray<ProjectFile>,
  ): boolean =>
    after.size === before.size &&
    Arr.every(
      Arr.zip([...before], [...after]),
      ([[name, original], [afterName, afterFile]]) => afterName === name && afterFile === expectedOf(updates, original),
    )

  it.prop(
    '∀updates_PreprocessedFiles_≡LastUpdateWinsInPlaceWithinExistingKeys',
    { of: [DrawnFiles, DrawnUpdates], subject: withPreprocessedFiles },
    (subject, [files, drawnUpdates]) => {
      const project = projectOf(files)
      const updates = updatesOf(project, drawnUpdates)
      const merged = subject(project, updates)
      return replacesExactlyTheUpdatedInPlace(project.files, merged.files, updates) &&
        replacesExactlyTheUpdatedInPlace(project.filesToMutate, merged.filesToMutate, updates)
    },
  )
}
