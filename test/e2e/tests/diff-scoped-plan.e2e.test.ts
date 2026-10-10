import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect, Result, Schema } from 'effect'

import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { verifyPersistedAnnotations } from './__fixtures__/annotation-oracle.fixture.js'
import { E2eHarnessLive, runStrykerGuest } from './__fixtures__/e2e-harness.fixture.js'
import { readPersistedReport } from './__fixtures__/run-artifacts.fixture.js'

const FIXTURE = 'diff-scope-fixture'
const FIXTURE_URL = new URL('../testResources/diff-scope-fixture', import.meta.url)
const SLICE = 'stryker.config.ts'
const TARGET_FILE = 'src/target.ts'
const OTHER_FILE = 'src/other.ts'
const MUTATED_LINE = 3
const SHAS_FILE = 'repo-shas.txt'
const PLAN_ONE_FILE = 'plan-1.json'
const PLAN_THREE_FILE = 'plan-3.json'
const MERGED_REPORT_FILE = 'reports/mutation/mutation.json'
const FEATURE_TIMEOUT_MILLIS = 900_000

const JOURNEY_SCRIPT = `
set -eu
apk add --no-cache git >/dev/null
git init -q .
git config user.email e2e-diff-scope@example.invalid
git config user.name "e2e diff scope"
cp src/target.ts /tmp/diff-scope-b-target.ts
sed -i '3s/a + b/a - b/' src/target.ts
git add -A
GIT_AUTHOR_DATE=2020-01-01T00:00:00Z GIT_COMMITTER_DATE=2020-01-01T00:00:00Z git commit -q -m A
cp /tmp/diff-scope-b-target.ts src/target.ts
git add -A
GIT_AUTHOR_DATE=2020-01-02T00:00:00Z GIT_COMMITTER_DATE=2020-01-02T00:00:00Z git commit -q -m B
BASE=$(git rev-parse HEAD~1)
echo "$BASE" > repo-shas.txt
git rev-parse HEAD >> repo-shas.txt
npx --no-install stryker plan --since "$BASE" --max-shards 1 --target-seconds 1 --out plan-1.json
npx --no-install stryker plan --since "$BASE" --max-shards 3 --target-seconds 1 --out plan-3.json
N=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync("plan-3.json","utf8")).shards.length))')
k=1
while [ "$k" -le "$N" ]; do
  npx --no-install stryker run --plan plan-3.json --shard "$k/$N"
  k=$((k+1))
done
DIRS=""
k=1
while [ "$k" -le "$N" ]; do DIRS="$DIRS reports/shards/$k"; k=$((k+1)); done
npx --no-install stryker merge --plan plan-3.json --out reports/mutation $DIRS
`

interface GitShas {
  readonly base: string
  readonly head: string
}

interface DiffScopeObservation {
  readonly tag: string
  readonly base: string | null
  readonly head: string | null
}

const shasOf = (text: string): GitShas => {
  const [base, head] = text.trim().split('\n')
  if (base === undefined || head === undefined) {
    throw new Error(`${SHAS_FILE} does not hold two revisions: ${JSON.stringify(text)}`)
  }
  return { base, head }
}

const plannedIdsOf = (plan: ShardPlan): ReadonlyArray<string> =>
  plan.shards.flatMap((shard) => shard.projects.flatMap((project) => project.mutants))

const sortedIds = (ids: ReadonlyArray<string>): ReadonlyArray<string> => [...ids].sort()

const diffScopeOf = (plan: ShardPlan): DiffScopeObservation =>
  plan.scope._tag === 'DiffScoped'
    ? { tag: plan.scope._tag, base: plan.scope.base, head: plan.scope.head }
    : { tag: plan.scope._tag, base: null, head: null }

const decodePlan = (file: string, text: string): ShardPlan =>
  Result.match(Schema.decodeUnknownResult(ShardPlan)(JSON.parse(text)), {
    onFailure: (issue) => {
      throw new Error(`${file} did not decode as a shard plan: ${issue.message}`)
    },
    onSuccess: (plan) => plan,
  })

const verifyExit = (expect: Expect, run: ExecResult): Check =>
  expect({ exitCode: run.exitCode }).toStrictEqual({ exitCode: 0 })

const verifyDiffScopedPlans = (expect: Expect, shas: GitShas, plan1: ShardPlan, plan3: ShardPlan): Check => {
  const ids1 = sortedIds(plannedIdsOf(plan1))
  const ids3 = sortedIds(plannedIdsOf(plan3))
  return expect({
    plan1: diffScopeOf(plan1),
    plan3: diffScopeOf(plan3),
    idsAreEqual: ids1.join(',') === ids3.join(','),
    idsAreNonEmpty: ids3.length > 0,
  }).toStrictEqual({
    plan1: { tag: 'DiffScoped', base: shas.base, head: shas.head },
    plan3: { tag: 'DiffScoped', base: shas.base, head: shas.head },
    idsAreEqual: true,
    idsAreNonEmpty: true,
  })
}

const verifyMergedReport = (expect: Expect, plan3: ShardPlan, report: Report.MutationTestResult): Check => {
  const mutants = Object.entries(report.files).flatMap(([file, fileResult]) =>
    fileResult.mutants.map((mutant) => ({ file, mutant }))
  )
  const plannedIds = sortedIds(plannedIdsOf(plan3))
  return expect({
    mutantsAreNonEmpty: mutants.length > 0,
    everyMutantIsOnTheChangedLine: mutants.every(({ mutant }) => mutant.location.start.line === MUTATED_LINE),
    everyMutantIsInTheTargetFile: mutants.every(({ file }) => file.endsWith(TARGET_FILE)),
    noMutantIsInTheOtherFile: mutants.every(({ file }) => !file.endsWith(OTHER_FILE)),
    mutantIds: sortedIds(mutants.map(({ mutant }) => mutant.id)),
  }).toStrictEqual({
    mutantsAreNonEmpty: true,
    everyMutantIsOnTheChangedLine: true,
    everyMutantIsInTheTargetFile: true,
    noMutantIsInTheOtherFile: true,
    mutantIds: plannedIds,
  })
}

const Feature = makeFeature({ it })

Feature('Planning a diff-scoped shard plan through the packed CLI', { timeout: FEATURE_TIMEOUT_MILLIS })
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM for the diff-scope fixture and drives git, plan, shard and merge through the packed CLI, exporting their spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'A two-commit repository plans, shards and merges only the mutants of its changed third line',
      Gherkin.Do.pipe(
        When('the guest builds the two-commit repository and runs the plan, shard and merge chain')(
          'session',
          () =>
            runStrykerGuest({
              fixture: FIXTURE_URL,
              label: FIXTURE,
              argv: ['sh', '-c', JOURNEY_SCRIPT],
            }),
        ),
        Then('the plan, shard and merge chain exited cleanly')((s, expect) =>
          verifyExit(expect, s.session.output.result)
        ),
        When('the revisions, both plans and the merged report are read from the guest')(
          'artifacts',
          (s) =>
            Effect.gen(function*() {
              const shasText = yield* s.session.output.readFile(SHAS_FILE)
              const plan1Text = yield* s.session.output.readFile(PLAN_ONE_FILE)
              const plan3Text = yield* s.session.output.readFile(PLAN_THREE_FILE)
              const report = yield* readPersistedReport(MERGED_REPORT_FILE, s.session.output.readFile)
              return {
                shas: shasOf(shasText),
                plan1: decodePlan(PLAN_ONE_FILE, plan1Text),
                plan3: decodePlan(PLAN_THREE_FILE, plan3Text),
                report,
              }
            }),
        ),
        Then('both plans are DiffScoped from commit A to commit B with one shared non-empty mutant set')(
          (s, expect) => verifyDiffScopedPlans(expect, s.artifacts.shas, s.artifacts.plan1, s.artifacts.plan3),
        ),
        Then('the merged report holds exactly the planned mutants, every one on the changed third line')((s, expect) =>
          verifyMergedReport(expect, s.artifacts.plan3, s.artifacts.report)
        ),
        Then('every merged mutant matches its authored annotation')((s, expect) =>
          verifyPersistedAnnotations(expect, { fixture: FIXTURE, slice: SLICE, report: s.artifacts.report })
        ),
      ),
    )
  })
