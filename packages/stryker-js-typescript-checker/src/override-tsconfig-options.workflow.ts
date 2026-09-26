import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { OverrideTsconfigOptionsCommand } from './CheckerCommands.schema.js'
import type { TsConfigCompilerOptions, TsConfigDocument } from './Tsconfig.schema.js'

const OverrideTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/TsconfigOverride')
type OverrideTypeId = typeof OverrideTypeId

export class ProjectReferencesOverride extends S.TaggedClass<ProjectReferencesOverride>()(
  'ProjectReferencesOverride',
  {
    text: S.String,
  },
) {
  readonly [OverrideTypeId] = OverrideTypeId
}

export class SingleProjectOverride extends S.TaggedClass<SingleProjectOverride>()('SingleProjectOverride', {
  text: S.String,
}) {
  readonly [OverrideTypeId] = OverrideTypeId
}

export const TsconfigOverride = S.Union([ProjectReferencesOverride, SingleProjectOverride])
export type TsconfigOverride = typeof TsconfigOverride.Type

type CompilerOptionValue = boolean | string | number | ReadonlyArray<string> | undefined

type CompilerOptions = TsConfigCompilerOptions

const COMPILER_OPTIONS_OVERRIDES: Readonly<Record<string, CompilerOptionValue>> = Object.freeze({
  allowUnreachableCode: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  skipLibCheck: true,
})

const NO_EMIT_OPTIONS_FOR_SINGLE_PROJECT: Readonly<Record<string, CompilerOptionValue>> = Object.freeze({
  noEmit: true,
  incremental: false,
  tsBuildInfoFile: undefined,
  composite: false,
})

const LOW_EMIT_OPTIONS_FOR_PROJECT_REFERENCES: Readonly<Record<string, CompilerOptionValue>> = Object.freeze({
  emitDeclarationOnly: true,
  noEmit: false,
  declarationMap: true,
  declaration: true,
  composite: true,
})

const compilerOptionsOf = (document: TsConfigDocument): CompilerOptions =>
  Option.getOrElse(Option.fromUndefinedOr(document.compilerOptions), (): CompilerOptions => ({}))

const withCompilerOverrides = (
  document: TsConfigDocument,
  extraOptions: Readonly<Record<string, CompilerOptionValue>>,
) => ({
  ...compilerOptionsOf(document),
  ...COMPILER_OPTIONS_OVERRIDES,
  ...extraOptions,
})

const projectReferencesJson = (document: TsConfigDocument): string => {
  const compilerOptions = withCompilerOverrides(document, LOW_EMIT_OPTIONS_FOR_PROJECT_REFERENCES)
  delete compilerOptions['inlineSourceMap']
  delete compilerOptions['inlineSources']
  delete compilerOptions['mapRoute']
  delete compilerOptions['sourceRoot']
  delete compilerOptions['outFile']
  return JSON.stringify({ ...document, compilerOptions })
}

const singleProjectJson = (document: TsConfigDocument): string => {
  const compilerOptions = withCompilerOverrides(document, NO_EMIT_OPTIONS_FOR_SINGLE_PROJECT)
  Boolean.match(compilerOptions['declarationDir'] !== null, {
    onTrue: () => {
      delete compilerOptions['declarationDir']
    },
    onFalse: () => undefined,
  })
  const { references: _references, ...withoutReferences } = document
  return JSON.stringify({ ...withoutReferences, compilerOptions })
}

const decide = (command: OverrideTsconfigOptionsCommand): Result.Result<TsconfigOverride, never> =>
  Result.succeed(
    Boolean.match(command.buildMode, {
      onTrue: () => ProjectReferencesOverride.make({ text: projectReferencesJson(command.document) }),
      onFalse: () => SingleProjectOverride.make({ text: singleProjectJson(command.document) }),
    }),
  )

export const overrideTsconfigOptions = Workflow.make({
  command: OverrideTsconfigOptionsCommand,
  decision: TsconfigOverride,
  error: S.Never,
  decide,
})
