import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type { ChildProcessSpawner } from 'effect/process'
import type * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchCorpusJson } from './bench-corpus.schema.js'
import { type LegSelection, type NoBenchBase, TurboAffectedPaths } from './bench-plan.schema.js'
import { runChecked, runCommand } from './command.service.js'
import { ENGINE_BUILD_DIRS } from './engine-dirs.js'
import { BenchSetupFailed } from './prepare-side.schema.js'
import { selectLegs, SelectLegsCommand } from './select-legs.workflow.js'

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

const greenRunShas = (input: PlanLegsInput) =>
  runChecked({
    step: STEP_GREEN_RUNS,
    argv: [
      'gh',
      'api',
      `repos/${input.repository}/actions/workflows/bench.yml/runs?branch=main&event=push&status=success&per_page=100`,
      '--jq',
      '.workflow_runs[].head_sha',
    ],
    cwd: input.repoRoot,
  }).pipe(Effect.map((outcome) => linesOf(outcome.stdout)))

const isStrictAncestor = (input: PlanLegsInput, sha: string) =>
  runCommand({ argv: ['git', 'merge-base', '--is-ancestor', sha, input.head], cwd: input.repoRoot }).pipe(
    Effect.map((outcome) => outcome.exitCode === 0 && sha !== input.head),
  )

const greenAncestorOf = (input: PlanLegsInput) =>
  Effect.flatMap(greenRunShas(input), (shas) => Effect.findFirst(shas, (sha) => isStrictAncestor(input, sha)))

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
      argv: ['pnpm', 'exec', 'turbo', 'query', 'affected', '--packages', '--base', base, '--head', input.head],
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

const diffSince = (input: PlanLegsInput, green: Option.Option<string>) =>
  Option.match(green, {
    onNone: () => Effect.succeed({ changedFiles: [], affectedPaths: [] }),
    onSome: (base) =>
      Effect.all({ changedFiles: changedFilesSince(input, base), affectedPaths: affectedPathsSince(input, base) }),
  })

const greenAncestorFor = (input: PlanLegsInput) =>
  Match.value(input.event).pipe(
    Match.when('push', () => greenAncestorOf(input)),
    Match.when('workflow_dispatch', () => Effect.succeed(Option.none<string>())),
    Match.exhaustive,
  )

export const planLegs = (
  input: PlanLegsInput,
): Effect.Effect<Result.Result<LegSelection, NoBenchBase>, BenchSetupFailed, PlanPlatform> =>
  Effect.gen(function*() {
    const entries = yield* corpusEntries(input)
    const greenAncestor = yield* greenAncestorFor(input)
    const firstParent = yield* firstParentOf(input)
    const diff = yield* diffSince(input, greenAncestor)
    return selectLegs(SelectLegsCommand.make({
      event: input.event,
      head: input.head,
      greenAncestor,
      firstParent,
      entries,
      engineDirs: [...ENGINE_BUILD_DIRS],
      ...diff,
    }))
  })
