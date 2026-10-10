import type { Format } from '@systemfsoftware/stryker-js-instrumenter'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import type * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'

import type { ProjectFiles } from './project-files.service.js'
import type { Project } from './Project.schema.js'
import type { StrykerError } from './stryker-error.schema.js'

export interface MakeSandboxInput {
  readonly options: Options.StrykerOptions
  readonly project: Project
  readonly workingDirectory: string
  readonly backupDirectory: string
  readonly basePath: string
  readonly formatRegistry: Format.FormatRegistry
}

export type FilePreprocessor = (
  project: Project,
) => Effect.Effect<Project, PlatformError | StrykerError, FileSystem.FileSystem | Path.Path | ProjectFiles>

export interface SandboxSpec extends MakeSandboxInput {
  readonly preprocessors: readonly FilePreprocessor[]
}

const JsonRecord = S.Record(S.String, S.Unknown)

const Entries = S.String.pipe(S.Array, S.optionalKey)

export const TsConfigSchema = S.StructWithRest(
  S.Struct({
    extends: S.optionalKey(S.Union([S.String, S.Array(S.String)])),
    references: S.StructWithRest(S.Struct({ path: S.String }), [JsonRecord]).pipe(S.Array, S.optionalKey),
    files: Entries,
    include: Entries,
    exclude: Entries,
  }),
  [JsonRecord],
)

export type TSConfig = S.Schema.Type<typeof TsConfigSchema>

export const ExtendsArraySchema = S.Array(S.String)

const entriesOf = (entries: ReadonlyArray<string> | undefined): ReadonlyArray<string> => entries ?? []

export const extendsEntriesOf = (config: TSConfig): ReadonlyArray<string> =>
  Match.value(config.extends).pipe(
    Match.when(Predicate.isUndefined, () => []),
    Match.when(Predicate.isString, (entry) => [entry]),
    Match.when(S.is(ExtendsArraySchema), (entries) => entries),
    Match.exhaustive,
  )

export const referencePathsOf = (config: TSConfig): ReadonlyArray<string> =>
  Option.match(Option.fromUndefinedOr(config.references), {
    onNone: () => [],
    onSome: (references) => Arr.map(references, (reference) => reference.path),
  })

export const referencedEntriesOf = (config: TSConfig): ReadonlyArray<string> => [
  ...entriesOf(config.include),
  ...entriesOf(config.exclude),
  ...entriesOf(config.files),
  ...extendsEntriesOf(config),
  ...referencePathsOf(config),
]

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const Drawn = S.Array(S.String).pipe(S.check(S.isMaxLength(6)))
  const DrawnExtends = S.Union([S.String, Drawn])
  const DrawnConfig = S.Struct({
    include: S.optionalKey(Drawn),
    exclude: S.optionalKey(Drawn),
    files: S.optionalKey(Drawn),
    extends: S.optionalKey(DrawnExtends),
    references: S.optionalKey(Drawn),
  })
  type DrawnConfig = typeof DrawnConfig.Type

  const referencesOf = (paths: ReadonlyArray<string> | undefined): Pick<TSConfig, 'references'> =>
    Option.match(Option.fromUndefinedOr(paths), {
      onNone: () => ({}),
      onSome: (present) => ({ references: Arr.map(present, (path) => ({ path, prepend: true })) }),
    })

  const configOf = ({ references, ...rest }: DrawnConfig): TSConfig => ({
    ...rest,
    ...referencesOf(references),
    compilerOptions: { strict: true },
  })

  const listOf = (drawn: string | ReadonlyArray<string> | undefined): ReadonlyArray<string> => [drawn ?? []].flat()

  const sameSequence = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
    left.length === right.length && Arr.every(Arr.zip(left, right), ([entry, other]) => entry === other)

  it.prop(
    '∀config_ExtendsEntries_≡EveryExtendsEntryInOrder',
    { of: [DrawnConfig], subject: extendsEntriesOf },
    (subject, [drawn]) => sameSequence(subject(configOf(drawn)), listOf(drawn.extends)),
  )

  it.prop(
    '∀config_ReferencePaths_≡EveryReferencePathInOrder',
    { of: [DrawnConfig], subject: referencePathsOf },
    (subject, [drawn]) => sameSequence(subject(configOf(drawn)), listOf(drawn.references)),
  )

  it.prop(
    '∀config_ReferencedEntries_≡IncludeExcludeFilesExtendsReferencesInThatOrder',
    { of: [DrawnConfig], subject: referencedEntriesOf },
    (subject, [drawn]) =>
      sameSequence(
        subject(configOf(drawn)),
        Arr.flatMap([drawn.include, drawn.exclude, drawn.files, drawn.extends, drawn.references], listOf),
      ),
  )

  it.prop(
    '∀entries_Entries_≡TheEntriesWhenPresentNoneWhenAbsent',
    { of: [S.UndefinedOr(Drawn)], subject: entriesOf },
    (subject, [drawn]) =>
      Option.match(Option.fromUndefinedOr(drawn), {
        onNone: () => subject(drawn).length === 0,
        onSome: (present) => sameSequence(subject(drawn), present),
      }),
  )
}
