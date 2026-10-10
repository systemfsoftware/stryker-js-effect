import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'

import { verifyAnnotatedRun } from './__fixtures__/annotation-oracle.fixture.js'
import { E2eHarnessLive, runGuestScript, type StrykerRunOutput } from './__fixtures__/e2e-harness.fixture.js'
import {
  decodeStream,
  type MachineStreamError,
  reuseEventOf,
  verdictEvent,
} from './__fixtures__/machine-stream.fixture.js'
import { DEFAULT_VERDICT_DIRECTORY, readReportOf } from './__fixtures__/run-artifacts.fixture.js'

const FIXTURE_URL = new URL('../testResources/verdict-store-fixture', import.meta.url)
const STORED_ENTRIES_BEFORE_THE_KILL = 2
const KILL_POLLS = 1200
const SIGKILLED_EXIT_CODE = 137
const LOG_TAIL_CHARS = 2000

const STRYKER = 'npx --no-install stryker'

const SHARDS_THEN_KILL_THEN_RERUN = `
set -u
mkdir -p reports
${STRYKER} plan --target-seconds 0.001 --max-shards 2 --out plan.json > reports/plan.log 2>&1
echo $? > reports/plan.exit
setsid ${STRYKER} run --plan plan.json --shard 1/2 --out reports/shard-1 > reports/killed.log 2>&1 &
killed=$!
${STRYKER} run --plan plan.json --shard 2/2 --out reports/shard-2 > reports/survivor.log 2>&1 &
survivor=$!
stored() { find ${DEFAULT_VERDICT_DIRECTORY} -type f -name '*.json' ! -name '.*' 2>/dev/null | wc -l; }
polls=0
while kill -0 "$killed" 2>/dev/null && [ "$(stored)" -lt ${STORED_ENTRIES_BEFORE_THE_KILL} ] && [ "$polls" -lt ${KILL_POLLS} ]; do
  sleep 0.05
  polls=$((polls + 1))
done
kill -9 -- "-$killed" 2>/dev/null
wait "$killed"
echo $? > reports/killed.exit
wait "$survivor"
echo $? > reports/survivor.exit
for directory in ${DEFAULT_VERDICT_DIRECTORY}/*/*/; do
  ls "$directory" | grep -v '^[.]' | grep -q '[.]json$' && basename "$directory"
done > reports/stored-before-rerun.txt
${STRYKER} run --incremental > reports/rerun.ndjson 2> reports/rerun.log
echo $? > reports/rerun.exit
`

interface ScriptArtifacts {
  readonly planExit: number
  readonly killedExit: number
  readonly survivorExit: number
  readonly rerunExit: number
  readonly storedBeforeRerun: ReadonlyArray<string>
  readonly rerunEvents: ReadonlyArray<RunEvent.RunEvent>
  readonly logs: string
}

const exitOf = (text: string): number => Number.parseInt(text.trim(), 10)

const linesOf = (text: string): ReadonlyArray<string> => text.split('\n').filter((line) => line.length > 0)

const readArtifacts = (output: StrykerRunOutput): Effect.Effect<ScriptArtifacts, MachineStreamError> =>
  Effect.gen(function*() {
    const read = (file: string) => output.readFile(`reports/${file}`).pipe(Effect.orElseSucceed(() => ''))
    const logs = yield* Effect.forEach(
      ['plan.log', 'killed.log', 'survivor.log', 'rerun.log'],
      (file) => Effect.map(read(file), (text) => `--- ${file}\n${text.slice(-LOG_TAIL_CHARS)}`),
    )
    return {
      planExit: exitOf(yield* read('plan.exit')),
      killedExit: exitOf(yield* read('killed.exit')),
      survivorExit: exitOf(yield* read('survivor.exit')),
      rerunExit: exitOf(yield* read('rerun.exit')),
      storedBeforeRerun: linesOf(yield* read('stored-before-rerun.txt')),
      rerunEvents: yield* decodeStream(yield* read('rerun.ndjson')),
      logs: logs.join('\n'),
    }
  })

const refusalsLineOf = (refused: RunEvent.ReuseRefusals): string =>
  Object.entries(refused)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason} ${count}`)
    .sort()
    .join(', ')

const verifyStoreSurvivedTheKill = (
  expect: Expect,
  artifacts: ScriptArtifacts,
  reuse: RunEvent.ReuseReported,
): Check => {
  const total = reuse.reused + reuse.ran
  const stored = artifacts.storedBeforeRerun.length
  const exits = JSON.stringify({
    plan: artifacts.planExit,
    killed: artifacts.killedExit,
    survivor: artifacts.survivorExit,
    rerun: artifacts.rerunExit,
  })
  const expectedExits = JSON.stringify({ plan: 0, killed: SIGKILLED_EXIT_CODE, survivor: 0, rerun: 0 })
  const unstored = total - stored
  const expectedRefusals = unstored > 0 ? `noPriorRecord ${unstored}` : ''
  return expect({
    exits,
    logs: exits === expectedExits ? '' : artifacts.logs,
    killLandedMidRun: stored > 0 && stored < total,
    rerun: `${stored} stored of ${total}: reused ${reuse.reused}; refused ${refusalsLineOf(reuse.refused)}`,
  }).toStrictEqual({
    exits: expectedExits,
    logs: '',
    killLandedMidRun: true,
    rerun: `${stored} stored of ${total}: reused ${stored}; refused ${expectedRefusals}`,
  })
}

const Feature = makeFeature({ it })

Feature('Keeping one verdict store readable under parallel shards and a killed writer', { timeout: 900_000 })
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM that runs packed CLI processes side by side against one filesystem store, exporting spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'Two shards write one store, one is SIGKILLed mid-run, and the next run reuses every verdict either stored',
      Gherkin.Do.pipe(
        When('two shard processes write one store and one is killed after the store holds its first entries')(
          'script',
          () =>
            runGuestScript({
              fixture: FIXTURE_URL,
              label: 'verdict-store-shards-and-kill',
              script: SHARDS_THEN_KILL_THEN_RERUN,
            }),
        ),
        When('the exit codes, the store and the re-run event stream are read from the microVM')(
          'artifacts',
          (s) => readArtifacts(s.script.output),
        ),
        When('the re-run reports its reuse counts')('reuse', (s) => reuseEventOf(s.artifacts.rerunEvents)),
        Then('no stored entry is unreadable and the re-run reuses exactly the mutants the store held')((s, expect) =>
          verifyStoreSurvivedTheKill(expect, s.artifacts, s.reuse)
        ),
        When('the terminal verdict of the re-run event stream is read')(
          'verdict',
          (s) => verdictEvent(s.artifacts.rerunEvents),
        ),
        When('the report the verdict names is read and decoded')(
          'report',
          (s) => readReportOf(s.verdict, s.script.output.readFile),
        ),
        Then('every reported mutant matches its authored annotation and the verdict tallies agree')((s, expect) =>
          verifyAnnotatedRun(expect, {
            fixture: 'verdict-store-fixture',
            slice: 'stryker.config.ts',
            report: s.report,
            verdict: s.verdict,
          })
        ),
      ),
    )
  })
