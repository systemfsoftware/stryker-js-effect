import { Workflow } from '@systemfsoftware/effect-cell-types'
import { BenchSide } from '@systemfsoftware/stryker-e2e-core'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { RunPathMoveIn, RunPathOccupied, RunPathOutsideTree, RunPathPlan } from './run-path.schema.js'

export class PlanRunPathCommand extends S.TaggedClass<PlanRunPathCommand>()('PlanRunPathCommand', {
  runnerTemp: S.NonEmptyString,
  runnerTempEntries: S.Array(S.String),
  side: BenchSide,
  tree: S.NonEmptyString,
  cwd: S.NonEmptyString,
  cli: S.NonEmptyString,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const RUN_PATH_NAME = 'bench-run'

const withoutTrailingSlashes = (path: string): string => path.replace(/\/+$/, '')

const rebased = (
  command: PlanRunPathCommand,
  runPath: string,
  path: string,
): Result.Result<string, RunPathOutsideTree> => {
  const tree = withoutTrailingSlashes(command.tree)
  return Boolean.match(Boolean.or(path === tree, path.startsWith(`${tree}/`)), {
    onTrue: () => Result.succeed(`${runPath}${path.slice(tree.length)}`),
    onFalse: () => Result.fail(RunPathOutsideTree.make({ side: command.side, tree: command.tree, path })),
  })
}

const moveInOf = (command: PlanRunPathCommand, runPath: string): Result.Result<RunPathPlan, RunPathOutsideTree> =>
  Result.flatMap(
    rebased(command, runPath, command.cwd),
    (cwd) =>
      Result.map(
        rebased(command, runPath, command.cli),
        (cli): RunPathPlan => RunPathMoveIn.make({ side: command.side, tree: command.tree, runPath, cwd, cli }),
      ),
  )

const decide = (command: PlanRunPathCommand): Result.Result<RunPathPlan, RunPathOutsideTree> => {
  const runPath = `${withoutTrailingSlashes(command.runnerTemp)}/${RUN_PATH_NAME}`
  return Boolean.match(command.runnerTempEntries.includes(RUN_PATH_NAME), {
    onTrue: () => Result.succeed<RunPathPlan>(RunPathOccupied.make({ side: command.side, runPath })),
    onFalse: () => moveInOf(command, runPath),
  })
}

export const planRunPath = Workflow.make({
  command: PlanRunPathCommand,
  decision: RunPathPlan,
  error: RunPathOutsideTree,
  decide,
})
