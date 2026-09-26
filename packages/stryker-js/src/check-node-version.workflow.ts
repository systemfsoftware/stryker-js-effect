import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const CheckNodeVersionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/CheckNodeVersion')
type CheckNodeVersionTypeId = typeof CheckNodeVersionTypeId

const SUPPORTED_NODE_MAJOR = 20

const versionNumbers = (version: string): readonly number[] =>
  version
    .replace(/^v/, '')
    .split(/[-+]/)
    .slice(0, 1)
    .flatMap((base) => base.split('.'))
    .map((part) => Number.parseInt(part, 10))

const componentAt = (numbers: readonly number[], index: number): number =>
  Option.getOrElse(Option.fromUndefinedOr(numbers[index]), () => 0)

const NODE_VERSION_REJECTIONS: readonly ((numbers: readonly number[]) => boolean)[] = [
  (numbers) => numbers.some(Number.isNaN),
  (numbers) => componentAt(numbers, 0) < SUPPORTED_NODE_MAJOR,
]

const rejectsVersion = (numbers: readonly number[]): boolean =>
  NODE_VERSION_REJECTIONS.some((rejects) => rejects(numbers))

export class CheckNodeVersionCommand extends S.TaggedClass<CheckNodeVersionCommand>()('CheckNodeVersionCommand', {
  version: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class NodeVersionSupported extends S.TaggedClass<NodeVersionSupported>()('NodeVersionSupported', {}) {
  readonly [CheckNodeVersionTypeId] = CheckNodeVersionTypeId
}

export class NodeVersionRejected extends S.TaggedClass<NodeVersionRejected>()('NodeVersionRejected', {}) {
  readonly [CheckNodeVersionTypeId] = CheckNodeVersionTypeId
}

export const checkNodeVersion = Workflow.make({
  command: CheckNodeVersionCommand,
  decision: S.Union([NodeVersionSupported, NodeVersionRejected]),
  error: S.Never,
  decide: (command): Result.Result<NodeVersionSupported | NodeVersionRejected, never> =>
    Result.succeed(
      Boolean.match(rejectsVersion(versionNumbers(command.version)), {
        onTrue: () => NodeVersionRejected.make({}),
        onFalse: () => NodeVersionSupported.make({}),
      }),
    ),
})
