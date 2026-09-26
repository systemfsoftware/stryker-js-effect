import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PlanResolutionCandidatesCommand } from './CheckerCommands.schema.js'

const ExtensionlessTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-typescript-checker/ResolutionCandidates',
)
type ExtensionlessTypeId = typeof ExtensionlessTypeId

export class ExtensionNamedPath extends S.TaggedClass<ExtensionNamedPath>()('ExtensionNamedPath', {
  candidates: S.Array(S.String),
}) {
  readonly [ExtensionlessTypeId] = ExtensionlessTypeId
}

export class ExtensionlessPath extends S.TaggedClass<ExtensionlessPath>()('ExtensionlessPath', {
  candidates: S.Array(S.String),
}) {
  readonly [ExtensionlessTypeId] = ExtensionlessTypeId
}

export const ResolutionCandidates = S.Union([ExtensionNamedPath, ExtensionlessPath])
export type ResolutionCandidates = typeof ResolutionCandidates.Type

const withoutExtensionCandidates = (resolved: string): ReadonlyArray<string> => [
  resolved,
  resolved + '.ts',
  resolved + '.tsx',
  resolved + '.d.ts',
  resolved + '/index.ts',
  resolved + '/index.tsx',
  resolved + '/index.d.ts',
  resolved + '.js',
  resolved + '.jsx',
  resolved + '.mjs',
  resolved + '.cjs',
  resolved + '/index.js',
  resolved + '/index.jsx',
  resolved + '/index.mjs',
  resolved + '/index.cjs',
]

const withExtensionCandidates = (resolved: string, extension: string): ReadonlyArray<string> => {
  const withoutExtension = resolved.slice(0, -extension.length)
  return [
    resolved,
    withoutExtension + '.ts',
    withoutExtension + '.tsx',
    withoutExtension + '.d.ts',
    withoutExtension + '.js',
    withoutExtension + '.jsx',
    withoutExtension + '.mjs',
    withoutExtension + '.cjs',
  ]
}

const decide = (command: PlanResolutionCandidatesCommand): Result.Result<ResolutionCandidates, never> =>
  Result.succeed(
    Boolean.match(command.extension === '', {
      onTrue: () => ExtensionlessPath.make({ candidates: withoutExtensionCandidates(command.resolved) }),
      onFalse: () =>
        ExtensionNamedPath.make({ candidates: withExtensionCandidates(command.resolved, command.extension) }),
    }),
  )

export const planResolutionCandidates = Workflow.make({
  command: PlanResolutionCandidatesCommand,
  decision: ResolutionCandidates,
  error: S.Never,
  decide,
})
