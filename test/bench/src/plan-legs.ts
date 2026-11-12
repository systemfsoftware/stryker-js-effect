import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type { ChildProcessSpawner } from 'effect/process'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchCorpusJson } from './bench-corpus.schema.js'
import {
  type BaseChoice,
  type GreenRun,
  GreenRunsJson,
  type LegSelection,
  type NoBenchBase,
} from './bench-plan.schema.js'
import { chooseBase, ChooseBaseCommand } from './choose-base.workflow.js'
import { runChecked, runCommand } from './command.js'
import { ENGINE_BUILD_DIRS } from './engine-dirs.js'
import { BenchSetupFailed } from './prepare-side.schema.js'
import { selectLegs, SelectLegsCommand } from './select-legs.workflow.js'
import { turboAffectedArgs } from './turbo-affected.js'
import { TurboAffectedPaths } from './turbo-affected.schema.js'

type PlanPlatform = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner

export interface PlanLegsInput {
  readonly event: 'push' | 'workflow_dispatch'
  readonly head: string
  readonly repository: string
  readonly repoRoot: string
  readonly corpusPath: string
}

const STEP_GREEN_RUNS = "list the lane's green push runs on main"
const STEP_DIFF = 'list the files changed since the base'
const STEP_AFFECTED = 'ask Turbo which packages changed since the base'
const STEP_CLEAN = "confirm the checkout is clean, since Turbo's affected set adds uncommitted changes"
const STEP_CORPUS = 'read the bench corpus'

const setupFailed = (step: string, detail: string): BenchSetupFailed => BenchSetupFailed.make({ step, detail })

const linesOf = (text: string): ReadonlyArray<string> => Arr.filter(text.split('\n'), (line) => line.length > 0)

const GREEN_RUNS_JQ = '[.workflow_runs[] | {sha: .head_sha, createdAtSeconds: (.created_at | fromdateiso8601)}]'

const greenRunListing = (input: PlanLegsInput) =>
  runChecked({
    step: STEP_GREEN_RUNS,
    argv: [
      'gh',
      'api',
      `repos/${input.repository}/actions/workflows/bench.yml/runs?branch=main&event=push&status=success&per_page=100`,
      '--jq',
      GREEN_RUNS_JQ,
    ],
    cwd: input.repoRoot,
  }).pipe(
    Effect.flatMap((outcome) =>
      S.decodeEffect(GreenRunsJson)(outcome.stdout).pipe(
        Effect.mapError((error) => setupFailed(STEP_GREEN_RUNS, `gh printed no green-run listing: ${error.message}`)),
      )
    ),
  )

const isAncestor = (input: PlanLegsInput, sha: string) =>
  runCommand({ argv: ['git', 'merge-base', '--is-ancestor', sha, input.head], cwd: input.repoRoot }).pipe(
    Effect.map((outcome) => outcome.exitCode === 0),
  )

const greenRunsOf = (input: PlanLegsInput): Effect.Effect<ReadonlyArray<GreenRun>, BenchSetupFailed, PlanPlatform> =>
  Effect.flatMap(
    greenRunListing(input),
    (listing) =>
      Effect.forEach(listing, (run) => Effect.map(isAncestor(input, run.sha), (ancestor) => ({ ...run, ancestor }))),
  )

const firstParentOf = (input: PlanLegsInput) =>
  runCommand({ argv: ['git', 'rev-parse', '--verify', '--quiet', `${input.head}^1`], cwd: input.repoRoot }).pipe(
    Effect.map((outcome) =>
      Option.liftPredicate(outcome.stdout.trim(), (sha) => outcome.exitCode === 0 && sha.length > 0)
    ),
  )

const changedFilesSince = (input: PlanLegsInput, base: string) =>
  runChecked({ step: STEP_DIFF, argv: ['git', 'diff', '--name-only', base, input.head], cwd: input.repoRoot }).pipe(
    Effect.map((outcome) => linesOf(outcome.stdout)),
  )

const cleanCheckout = (input: PlanLegsInput) =>
  runChecked({ step: STEP_CLEAN, argv: ['git', 'status', '--porcelain'], cwd: input.repoRoot }).pipe(
    Effect.filterOrFail(
      (outcome) => outcome.stdout.trim().length === 0,
      (outcome) => setupFailed(STEP_CLEAN, `the checkout has changes Turbo would count:\n${outcome.stdout}`),
    ),
  )

const affectedPathsSince = (input: PlanLegsInput, base: string) =>
  cleanCheckout(input).pipe(
    Effect.andThen(runChecked({
      step: STEP_AFFECTED,
      argv: ['pnpm', 'exec', 'turbo', ...turboAffectedArgs({ base, head: input.head })],
      cwd: input.repoRoot,
    })),
    Effect.flatMap((outcome) =>
      S.decodeEffect(TurboAffectedPaths)(outcome.stdout).pipe(
        Effect.mapError((error) =>
          setupFailed(STEP_AFFECTED, `turbo printed no affected-packages JSON: ${error.message}`)
        ),
      )
    ),
  )

const corpusEntries = (input: PlanLegsInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(input.corpusPath).pipe(
      Effect.mapError((cause) => setupFailed(STEP_CORPUS, `cannot read ${input.corpusPath}: ${cause.message}`)),
    )
    const corpus = yield* S.decodeEffect(BenchCorpusJson)(text).pipe(
      Effect.mapError((error) => setupFailed(STEP_CORPUS, `${input.corpusPath} does not decode: ${error.message}`)),
    )
    return Arr.append(Arr.map(corpus.repo, (entry) => entry.project), corpus.enterprise.fixture)
  })

const NO_DIFF = { changedFiles: [], affectedPaths: [] }

const diffSince = (input: PlanLegsInput, base: BaseChoice) =>
  Match.valueTags(base, {
    GreenBase: (green) =>
      Effect.all({
        changedFiles: changedFilesSince(input, green.sha),
        affectedPaths: affectedPathsSince(input, green.sha),
      }),
    FirstParentBase: () => Effect.succeed(NO_DIFF),
  })

const greenRunsFor = (input: PlanLegsInput) =>
  Match.value(input.event).pipe(
    Match.when('push', () => greenRunsOf(input)),
    Match.when('workflow_dispatch', () => Effect.succeed<ReadonlyArray<GreenRun>>([])),
    Match.exhaustive,
  )

const legsFrom = (input: PlanLegsInput, entries: Arr.NonEmptyArray<string>, base: BaseChoice) =>
  Effect.map(diffSince(input, base), (diff) =>
    selectLegs(SelectLegsCommand.make({
      base,
      entries,
      engineDirs: [...ENGINE_BUILD_DIRS],
      ...diff,
    })))

export const planLegs = (
  input: PlanLegsInput,
): Effect.Effect<Result.Result<LegSelection, NoBenchBase>, BenchSetupFailed, PlanPlatform> =>
  Effect.gen(function*() {
    const entries = yield* corpusEntries(input)
    const greenRuns = yield* greenRunsFor(input)
    const firstParent = yield* firstParentOf(input)
    const choice = chooseBase(ChooseBaseCommand.make({ event: input.event, head: input.head, greenRuns, firstParent }))
    return yield* Result.match(choice, {
      onFailure: (noBase) => noBase.pipe(Result.fail, Effect.succeed),
      onSuccess: (base) => legsFrom(input, entries, base),
    })
  })
