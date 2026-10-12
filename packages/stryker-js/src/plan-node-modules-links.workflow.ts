import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const PlanNodeModulesLinksTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/PlanNodeModulesLinks')
type PlanNodeModulesLinksTypeId = typeof PlanNodeModulesLinksTypeId

export class NodeModulesSearchCommand extends S.TaggedClass<NodeModulesSearchCommand>()('NodeModulesSearchCommand', {
  linking: S.Boolean,
  found: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class NodeModulesNotLinked extends S.TaggedClass<NodeModulesNotLinked>()('NodeModulesNotLinked', {}) {
  readonly [PlanNodeModulesLinksTypeId] = PlanNodeModulesLinksTypeId
}

export class NodeModulesNotFound extends S.TaggedClass<NodeModulesNotFound>()('NodeModulesNotFound', {}) {
  readonly [PlanNodeModulesLinksTypeId] = PlanNodeModulesLinksTypeId
}

export class NodeModulesLinked extends S.TaggedClass<NodeModulesLinked>()('NodeModulesLinked', {
  nodeModules: S.NonEmptyArray(S.String),
}) {
  readonly [PlanNodeModulesLinksTypeId] = PlanNodeModulesLinksTypeId
}

export const NodeModulesLinks = S.Union([NodeModulesNotLinked, NodeModulesNotFound, NodeModulesLinked])
export type NodeModulesLinks = typeof NodeModulesLinks.Type

const linksOf = (found: ReadonlyArray<string>): NodeModulesLinks =>
  Arr.match(found, {
    onEmpty: (): NodeModulesLinks => NodeModulesNotFound.make({}),
    onNonEmpty: (nodeModules): NodeModulesLinks => NodeModulesLinked.make({ nodeModules }),
  })

const decide = (command: NodeModulesSearchCommand): Result.Result<NodeModulesLinks, never> =>
  Result.succeed(
    Boolean.match(command.linking, {
      onFalse: (): NodeModulesLinks => NodeModulesNotLinked.make({}),
      onTrue: () => linksOf(command.found),
    }),
  )

export const planNodeModulesLinks = Workflow.make({
  command: NodeModulesSearchCommand,
  decision: NodeModulesLinks,
  error: S.Never,
  decide,
})
