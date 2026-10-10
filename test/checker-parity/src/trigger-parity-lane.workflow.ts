import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const TriggerTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-checker-parity/TriggerParityLane')
type TriggerTypeId = typeof TriggerTypeId

const LISTED_FILES = 20

const SHARED_FILES: ReadonlyArray<string> = [
  '.github/workflows/ci.yml',
  'flake.lock',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
]

const SHARED_DIRECTORIES: ReadonlyArray<string> = ['.github/actions/', 'test/e2e/testResources/']

export class TriggerParityLaneCommand extends S.TaggedClass<TriggerParityLaneCommand>()('TriggerParityLaneCommand', {
  pushEvent: S.Boolean,
  closureDirectories: S.Array(S.String),
  changedFiles: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export const RunReason = S.Literals(['push', 'closure-changed', 'shared-input-changed'])
export type RunReason = typeof RunReason.Type

export class RunLane extends S.TaggedClass<RunLane>()('RunLane', {
  schemaVersion: S.Literal(1),
  reason: RunReason,
  matchedCount: S.Int,
  matched: S.Array(S.String),
}) {
  readonly [TriggerTypeId] = TriggerTypeId
}

export class SkipLane extends S.TaggedClass<SkipLane>()('SkipLane', {
  schemaVersion: S.Literal(1),
  reason: S.Literal('no-closure-change'),
  changedCount: S.Int,
}) {
  readonly [TriggerTypeId] = TriggerTypeId
}

export const LaneTrigger = S.Union([RunLane, SkipLane])
export type LaneTrigger = typeof LaneTrigger.Type

const insideDirectory = (file: string) => (directory: string): boolean => file.startsWith(`${directory}/`)

const startsWithAny = (prefixes: ReadonlyArray<string>) => (file: string): boolean =>
  prefixes.some((prefix) => file.startsWith(prefix))

const runFor = (reason: RunReason, matched: ReadonlyArray<string>): RunLane =>
  RunLane.make({ schemaVersion: 1, reason, matchedCount: matched.length, matched: matched.slice(0, LISTED_FILES) })

const runWhenAny = (reason: RunReason, matched: ReadonlyArray<string>): Option.Option<RunLane> =>
  Option.map(Option.liftPredicate(matched, Arr.isReadonlyArrayNonEmpty), (files) => runFor(reason, files))

const sharedInputsOf = (changedFiles: ReadonlyArray<string>): ReadonlyArray<string> =>
  Arr.dedupe([
    ...changedFiles.filter((file) => SHARED_FILES.includes(file)),
    ...changedFiles.filter(startsWithAny(SHARED_DIRECTORIES)),
  ])

const changeOf = (command: TriggerParityLaneCommand): LaneTrigger =>
  Option.getOrElse(
    Option.orElse(
      runWhenAny(
        'closure-changed',
        command.changedFiles.filter((file) => command.closureDirectories.some(insideDirectory(file))),
      ),
      () => runWhenAny('shared-input-changed', sharedInputsOf(command.changedFiles)),
    ),
    (): LaneTrigger =>
      SkipLane.make({ schemaVersion: 1, reason: 'no-closure-change', changedCount: command.changedFiles.length }),
  )

const triggerOf = (command: TriggerParityLaneCommand): LaneTrigger =>
  Boolean.match(command.pushEvent, {
    onTrue: (): LaneTrigger => runFor('push', []),
    onFalse: () => changeOf(command),
  })

export const triggerParityLane = Workflow.make({
  command: TriggerParityLaneCommand,
  decision: LaneTrigger,
  error: S.Never,
  decide: (command: TriggerParityLaneCommand): Result.Result<LaneTrigger, never> => Result.succeed(triggerOf(command)),
})
