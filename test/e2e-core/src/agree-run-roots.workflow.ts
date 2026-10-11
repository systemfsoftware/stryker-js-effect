import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchRun, BenchRunMeasured, RunIdentity } from './bench-run.schema.js'
import { type RunRoot, RunRootsAgreed, RunRootsDiffer } from './run-path.schema.js'

export class AgreeRunRootsCommand extends S.TaggedClass<AgreeRunRootsCommand>()('AgreeRunRootsCommand', {
  runs: S.Array(BenchRun),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const rootOf = (run: BenchRun): Option.Option<RunRoot> =>
  Option.flatMap(Option.liftPredicate(run, S.is(BenchRunMeasured)), (measured) =>
    Option.map(
      Option.liftPredicate(measured.identity, S.is(RunIdentity.cases.read)),
      (identity) => ({ key: measured.key, projectRoot: identity.projectRoot }),
    ))

const againstFirst = (
  roots: ReadonlyArray<RunRoot>,
  first: RunRoot,
): Result.Result<RunRootsAgreed, RunRootsDiffer> =>
  Option.match(Arr.findFirst(roots, (root) => root.projectRoot !== first.projectRoot), {
    onNone: () => Result.succeed(RunRootsAgreed.make({ projectRoot: first.projectRoot })),
    onSome: (other) => Result.fail(RunRootsDiffer.make({ first, other })),
  })

const decide = (command: AgreeRunRootsCommand): Result.Result<RunRootsAgreed, RunRootsDiffer> => {
  const roots = Arr.getSomes(Arr.map(command.runs, rootOf))
  return Option.match(Arr.head(roots), {
    onNone: () => Result.succeed(RunRootsAgreed.make({ projectRoot: null })),
    onSome: (first) => againstFirst(roots, first),
  })
}

export const agreeRunRoots = Workflow.make({
  command: AgreeRunRootsCommand,
  decision: RunRootsAgreed,
  error: RunRootsDiffer,
  decide,
})
