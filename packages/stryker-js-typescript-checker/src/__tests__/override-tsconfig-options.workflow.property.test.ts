import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { OverrideTsconfigOptionsCommand } from '../CheckerCommands.schema.js'
import { overrideTsconfigOptions } from '../override-tsconfig-options.workflow.js'

type JsonValue =
  | string
  | boolean
  | number
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }
type JsonTsConfig = { readonly [key: string]: JsonValue | undefined }

const jsonValueSchema = () => S.Union([S.String, S.Boolean, S.Int, S.Null])

const jsonRecordSchema = () => S.Record(S.String, jsonValueSchema())

const tsConfigLike = (): Arbitrary.Arbitrary<JsonTsConfig> =>
  Arbitrary.schema(
    S.Struct({
      extends: S.Union([S.String, S.Array(S.String)]).pipe(S.optional),
      include: S.String.pipe(S.Array, S.optional),
      files: S.String.pipe(S.Array, S.optional),
      exclude: S.String.pipe(S.Array, S.optional),
      references: S.Struct({ path: S.String }).pipe(S.Array, S.optional),
      compilerOptions: S.optional(jsonRecordSchema()),
    }),
  ).pipe(
    Arbitrary.map((generated): JsonTsConfig =>
      Object.fromEntries(Object.entries(generated).filter(([, value]) => value !== undefined))
    ),
  )

const isJsonObject = (value: unknown): value is JsonTsConfig =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const compilerOptionsOf = (config: JsonTsConfig): JsonTsConfig | undefined => {
  const compilerOptions = config['compilerOptions']
  return isJsonObject(compilerOptions) ? compilerOptions : undefined
}

const sourceEntriesOf = (source: JsonTsConfig | undefined): ReadonlyArray<readonly [string, JsonValue | undefined]> =>
  Object.entries(source ?? {})

const omitCompilerOptions = (value: JsonTsConfig): JsonTsConfig => {
  const { compilerOptions: _dropped, ...rest } = value
  return rest
}

const omitReferences = (value: JsonTsConfig): JsonTsConfig => {
  const { references: _dropped, ...rest } = value
  return rest
}

const parsedOverrideOf = (text: string): Option.Option<JsonTsConfig> =>
  Option.liftPredicate(JSON.parse(text), isJsonObject)

const overriddenOptionOf = (config: JsonTsConfig, key: string): JsonValue | undefined =>
  compilerOptionsOf(config)?.[key]

const DELIBERATE_IN_BUILD_MODE: Readonly<Record<string, JsonValue>> = {
  allowUnreachableCode: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  skipLibCheck: true,
  emitDeclarationOnly: true,
  noEmit: false,
  declarationMap: true,
  declaration: true,
  composite: true,
}

const DELIBERATE_IN_SINGLE_PROJECT: Readonly<Record<string, JsonValue>> = {
  allowUnreachableCode: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  skipLibCheck: true,
  noEmit: true,
  incremental: false,
  composite: false,
}

const ABSENT_IN_BUILD_MODE = ['inlineSourceMap', 'inlineSources', 'mapRoute', 'sourceRoot', 'outFile']

const ABSENT_IN_SINGLE_PROJECT = ['tsBuildInfoFile', 'declarationDir']

const touchedKeys = [
  ...Object.keys(DELIBERATE_IN_BUILD_MODE),
  ...ABSENT_IN_BUILD_MODE,
  ...Object.keys(DELIBERATE_IN_SINGLE_PROJECT),
  ...ABSENT_IN_SINGLE_PROJECT,
]

const untouchedCompilerOptionsPreserved = (
  source: JsonTsConfig | undefined,
  output: JsonTsConfig | undefined,
): boolean =>
  sourceEntriesOf(source).every(([key, value]) => touchedKeys.includes(key) || Equal.equals(output?.[key], value))

const deliberateOptionsMatch = (config: JsonTsConfig, deliberate: Readonly<Record<string, JsonValue>>): boolean =>
  Object.entries(deliberate).every(([key, value]) => Equal.equals(overriddenOptionOf(config, key), value))

const absentOptionsMatch = (config: JsonTsConfig, absent: ReadonlyArray<string>): boolean =>
  Arr.every(absent, (key) => overriddenOptionOf(config, key) === undefined)

const declarationDirHonoured = (original: JsonTsConfig, single: JsonTsConfig): boolean =>
  Equal.equals(compilerOptionsOf(original)?.['declarationDir'], null)
    ? Equal.equals(overriddenOptionOf(single, 'declarationDir'), null)
    : overriddenOptionOf(single, 'declarationDir') === undefined

const overrideTextOf = (document: JsonTsConfig, buildMode: boolean): string =>
  Result.match(overrideTsconfigOptions(OverrideTsconfigOptionsCommand.make({ document, buildMode })), {
    onFailure: (refused) => refused,
    onSuccess: (decision) => decision,
  }).text

const overrideTextsOf = (original: JsonTsConfig) => ({
  build: overrideTextOf(original, true),
  single: overrideTextOf(original, false),
})

describe('overrideTsconfigOptions', (it) => {
  it.prop(
    '∀tsconfig_Override_≡OriginalExceptDeliberateCompilerOverrides',
    { of: [tsConfigLike()], subject: overrideTextsOf },
    (subject, [original]) => {
      const texts = subject(original)
      return Option.match(
        Option.all({ build: parsedOverrideOf(texts.build), single: parsedOverrideOf(texts.single) }),
        {
          onNone: () => false,
          onSome: ({ build, single }) =>
            Arr.every(
              [
                Equal.equals(omitCompilerOptions(build), omitCompilerOptions(original)),
                Equal.equals(omitCompilerOptions(single), omitReferences(omitCompilerOptions(original))),
                deliberateOptionsMatch(build, DELIBERATE_IN_BUILD_MODE),
                deliberateOptionsMatch(single, DELIBERATE_IN_SINGLE_PROJECT),
                absentOptionsMatch(build, ABSENT_IN_BUILD_MODE),
                absentOptionsMatch(single, ABSENT_IN_SINGLE_PROJECT),
                declarationDirHonoured(original, single),
                untouchedCompilerOptionsPreserved(compilerOptionsOf(original), compilerOptionsOf(build)),
                untouchedCompilerOptionsPreserved(compilerOptionsOf(original), compilerOptionsOf(single)),
              ],
              (holds) => holds,
            ),
        },
      )
    },
  )
})
