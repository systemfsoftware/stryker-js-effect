import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ClassifySandboxDirectoryTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ClassifySandboxDirectory')
type ClassifySandboxDirectoryTypeId = typeof ClassifySandboxDirectoryTypeId

export class SandboxDirectoryCommand extends S.TaggedClass<SandboxDirectoryCommand>()('SandboxDirectoryCommand', {
  name: S.String,
  tempDirName: S.UndefinedOr(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class DirectorySkipped extends S.TaggedClass<DirectorySkipped>()('DirectorySkipped', {}) {
  readonly [ClassifySandboxDirectoryTypeId] = ClassifySandboxDirectoryTypeId
}

export class NodeModulesDirectory extends S.TaggedClass<NodeModulesDirectory>()('NodeModulesDirectory', {}) {
  readonly [ClassifySandboxDirectoryTypeId] = ClassifySandboxDirectoryTypeId
}

export class SearchableDirectory extends S.TaggedClass<SearchableDirectory>()('SearchableDirectory', {}) {
  readonly [ClassifySandboxDirectoryTypeId] = ClassifySandboxDirectoryTypeId
}

export const SandboxDirectoryRole = S.Union([DirectorySkipped, NodeModulesDirectory, SearchableDirectory])
export type SandboxDirectoryRole = typeof SandboxDirectoryRole.Type

const NODE_MODULES = 'node_modules'

const roleOfName = (name: string): SandboxDirectoryRole =>
  Boolean.match(name === NODE_MODULES, {
    onTrue: (): SandboxDirectoryRole => NodeModulesDirectory.make({}),
    onFalse: (): SandboxDirectoryRole => SearchableDirectory.make({}),
  })

const decide = (command: SandboxDirectoryCommand): Result.Result<SandboxDirectoryRole, never> =>
  Result.succeed(
    Boolean.match(command.name === command.tempDirName, {
      onTrue: (): SandboxDirectoryRole => DirectorySkipped.make({}),
      onFalse: () => roleOfName(command.name),
    }),
  )

export const classifySandboxDirectory = Workflow.make({
  command: SandboxDirectoryCommand,
  decision: SandboxDirectoryRole,
  error: S.Never,
  decide,
})
