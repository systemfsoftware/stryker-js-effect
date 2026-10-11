import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchRun, BenchRunMeasured, RunIdentity } from './bench-run.schema.js'
import {
  RunIdentityUnreadable,
  type RunRoot,
  RunRootsAgreed,
  RunRootsDiffer,
  RunRootsRefused,
} from './run-path.schema.js'

export class AgreeRunRootsCommand extends S.TaggedClass<AgreeRunRootsCommand>()('AgreeRunRootsCommand', {
  runs: S.Array(BenchRun),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const measuredOf = (runs: ReadonlyArray<BenchRun>): ReadonlyArray<BenchRunMeasured> =>
  Arr.filter(runs, S.is(BenchRunMeasured))

const unreadableOf = (run: BenchRunMeasured): Option.Option<RunIdentityUnreadable> =>
  Option.map(
    Option.liftPredicate(run.identity, S.is(RunIdentity.cases.unread)),
    (unread) => RunIdentityUnreadable.make({ key: run.key, file: unread.file, reason: unread.reason }),
  )

const rootOf = (run: BenchRunMeasured): Option.Option<RunRoot> =>
  Option.map(
    Option.liftPredicate(run.identity, S.is(RunIdentity.cases.read)),
    (identity) => ({ key: run.key, projectRoot: identity.projectRoot }),
  )

const againstFirst = (
  roots: ReadonlyArray<RunRoot>,
  first: RunRoot,
): Result.Result<RunRootsAgreed, RunRootsRefused> =>
  Option.match(Arr.findFirst(roots, (root) => root.projectRoot !== first.projectRoot), {
    onNone: () => Result.succeed(RunRootsAgreed.make({ projectRoot: first.projectRoot })),
    onSome: (other) => Result.fail(RunRootsDiffer.make({ first, other })),
  })

const rootsAgreement = (measured: ReadonlyArray<BenchRunMeasured>): Result.Result<RunRootsAgreed, RunRootsRefused> => {
  const roots = Arr.getSomes(Arr.map(measured, rootOf))
  return Option.match(Arr.head(roots), {
    onNone: () => Result.succeed(RunRootsAgreed.make({ projectRoot: null })),
    onSome: (first) => againstFirst(roots, first),
  })
}

const decide = (command: AgreeRunRootsCommand): Result.Result<RunRootsAgreed, RunRootsRefused> => {
  const measured = measuredOf(command.runs)
  return Option.match(Arr.findFirst(measured, unreadableOf), {
    onNone: () => rootsAgreement(measured),
    onSome: (unreadable) => Result.fail(unreadable),
  })
}

export const agreeRunRoots = Workflow.make({
  command: AgreeRunRootsCommand,
  decision: RunRootsAgreed,
  error: RunRootsRefused,
  decide,
})
