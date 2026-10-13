import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import * as Config from 'effect/Config'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type AffectedLegs,
  BenchLegsJson,
  type FullCorpus,
  type LegSelection,
  type NoBenchBase,
} from './bench-plan.schema.js'
import { planLegs } from './plan-legs.service.js'
import type { BenchSetupFailed } from './prepare-side.schema.js'

const planEnv = Effect.all({
  event: Config.Literals(['push', 'workflow_dispatch'], 'GITHUB_EVENT_NAME'),
  head: Config.NonEmptyString('GITHUB_SHA'),
  repository: Config.NonEmptyString('GITHUB_REPOSITORY'),
  repoRoot: Config.NonEmptyString('GITHUB_WORKSPACE'),
  output: Config.NonEmptyString('GITHUB_OUTPUT'),
  stepSummary: Config.NonEmptyString('GITHUB_STEP_SUMMARY'),
})

type PlanEnv = Effect.Success<typeof planEnv>

const FULL_CORPUS_WHY: Readonly<Record<FullCorpus['reason'], string>> = {
  dispatch: 'a manual dispatch benches the full corpus against the first parent',
  'no-green-ancestor':
    'no green Bench push run on main is an ancestor, so the full corpus runs against the first parent',
  'lane-inputs-changed': "the lane's own inputs changed since the last green commit, so the full corpus runs",
}

const listOf = (entries: ReadonlyArray<string>): string =>
  entries.length === 0 ? 'none' : entries.map((entry) => `\`${entry}\``).join(', ')

const summaryOf = (selection: LegSelection): string =>
  Match.valueTags(selection, {
    AffectedLegs: (affected: AffectedLegs) =>
      [
        '### Bench plan',
        '',
        `Side A is \`${affected.base}\`, the lane's last green main commit. Legs run are the entries whose packages Turbo reports affected since then.`,
        '',
        `- Run: ${listOf(affected.legs)}`,
        `- Skipped: ${listOf(affected.skipped)}`,
      ].join('\n'),
    FullCorpus: (full: FullCorpus) =>
      [
        '### Bench plan',
        '',
        `Side A is \`${full.base}\`: ${FULL_CORPUS_WHY[full.reason]}.`,
        '',
        `- Run: ${listOf(full.legs)}`,
      ].join('\n'),
  })

const publishSelection = (env: PlanEnv, selection: LegSelection) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const legs = yield* S.encodeEffect(BenchLegsJson)(selection.legs)
    yield* fs.writeFileString(env.output, `base=${selection.base}\nlegs=${legs}\n`, { flag: 'a' })
    yield* fs.writeFileString(env.stepSummary, `${summaryOf(selection)}\n`, { flag: 'a' })
    yield* Console.log(`bench plan: side A ${selection.base}; legs ${legs}`)
  })

const failWith = (title: string, message: string) =>
  Console.log(`::error title=${title}::${message}`).pipe(
    Effect.andThen(Effect.sync(() => {
      globalThis.process.exitCode = 1
    })),
  )

const program = Effect.gen(function*() {
  const env = yield* planEnv
  const path = yield* Path.Path
  const planned = yield* Effect.result(planLegs({
    event: env.event,
    head: env.head,
    repository: env.repository,
    repoRoot: env.repoRoot,
    corpusPath: path.join(env.repoRoot, 'test', 'bench', 'corpus.json'),
  }))
  yield* Result.match(planned, {
    onFailure: (failed: BenchSetupFailed) => failWith('Bench plan failed', `${failed.step}: ${failed.detail}`),
    onSuccess: (selection) =>
      Result.match(selection, {
        onFailure: (noBase: NoBenchBase) => failWith('Bench no base', noBase.message),
        onSuccess: (selected) => publishSelection(env, selected),
      }),
  })
}).pipe(
  Effect.catchTag('ConfigError', (error) => failWith('Bench plan environment incomplete', error.message)),
)

NodeRuntime.runMain({ disableErrorReporting: true })(program.pipe(Effect.provide(nodeServicesLayer)))
