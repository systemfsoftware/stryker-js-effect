import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import * as Option from 'effect/Option'

import {
  buildPreflightError,
  buildPreflightSummary,
  buildRequireError,
  buildSummary,
  combineParts,
  decodeInput,
  decodeJson,
  emptyRecord,
  evaluatedOf,
  evaluatedSummaryOf,
  JobOrNullSchema,
  JobsSchema,
  loadState,
  mergeRecord,
  mergeSarif,
  type Part,
  PartMetaSchema,
  planJobs,
  PnpmWorkspaceSchema,
  PREFLIGHT_FILE,
  ReportSchema,
  SarifLogSchema,
  type StagedPart,
  type SummaryInput,
  type TimingRecord,
} from './mutation-plan.ts'

const readFileFor = (files: Record<string, string>) => (path: string): Promise<string> =>
  path in files ? Promise.resolve(files[path]) : Promise.reject(new Error(`no such file: ${path}`))

const dir = 'packages/x/reports'

const inputOf = (overrides: Partial<SummaryInput> = {}): SummaryInput => ({
  package: 'packages/x',
  outcome: 'failure',
  reportsDir: dir,
  exitCode: 3,
  cwd: '/repo',
  ...overrides,
})

Deno.test('a package whose reports dir has no report requires one, naming the exit code', async () => {
  const state = await loadState(dir, readFileFor({}))
  assertStringIncludes(buildRequireError(inputOf({ exitCode: 7 }), state) ?? '', 'exit code: 7')
})

Deno.test('a complete report needs no record and no gate failure', async () => {
  const state = await loadState(
    dir,
    readFileFor({ [`${dir}/mutation-report.json`]: '{"schemaVersion":"1.0","files":{}}' }),
  )
  assertEquals(buildRequireError(inputOf(), state), null)
})

const shardPart = (index: number, files: string[]): StagedPart => ({
  meta: { package: 'packages/x', outcome: 'success', shard: { index, count: 2 } },
  report: { schemaVersion: '1.0', files: Object.fromEntries(files.map((file) => [file, {}])) },
})

Deno.test('combineParts refuses two shards that mutated the same file', () => {
  assertThrows(
    () => combineParts([shardPart(1, ['src/a.ts']), shardPart(2, ['src/a.ts'])]),
    Error,
    'both mutated',
  )
})

Deno.test('combineParts unions a complete shard set into one part per package', () => {
  const combined = combineParts([shardPart(2, ['src/b.ts']), shardPart(1, ['src/a.ts'])])
  assertEquals([...combined.keys()], ['packages/x'])
  const part = combined.get('packages/x')
  assertEquals(part?.meta, { package: 'packages/x', outcome: 'success' })
  assertEquals(Object.keys(part?.report?.files ?? {}).sort(), ['src/a.ts', 'src/b.ts'])
})

Deno.test('planJobs splits a package predicted over target into ceil(seconds/target) shards', () => {
  const record: TimingRecord = { version: 1, packages: { '@scope/over': { seconds: 1000, sha: 'abc' } } }
  const plan = planJobs([{ name: '@scope/over', dir: 'packages/over' }], record, {
    target: 300,
    maxJobs: 20,
    unknownSeconds: 300,
  })
  assertEquals(plan.jobs.map((job) => job.id), ['over-1', 'over-2', 'over-3', 'over-4'])
  assertEquals(
    plan.jobs.every((job) =>
      job.shard?.count === 4 && job.dirs[0] === 'packages/over' && job.packages[0] === '@scope/over'
    ),
    true,
  )
})

Deno.test('planJobs packs packages with no record at unknownSeconds', () => {
  const packages = [{ name: 'a', dir: 'packages/a' }, { name: 'b', dir: 'packages/b' }]
  const plan = planJobs(packages, emptyRecord, { target: 300, maxJobs: 20, unknownSeconds: 100 })
  assertEquals(plan.jobs.length, 1)
  assertEquals(plan.jobs[0].packages, ['a', 'b'])
  assertEquals(plan.jobs[0].predicted, 200)
})

Deno.test('mergeRecord keeps the previous duration when a shard is missing, sums a complete set', () => {
  const previous: TimingRecord = { version: 1, packages: { p: { seconds: 500, sha: 'old' } } }
  const incomplete: Part[] = [{
    job: 'p-1',
    entries: [{ package: 'p', seconds: 120, exitCode: 0, shard: { index: 1, count: 2 } }],
  }]
  assertEquals(mergeRecord(previous, incomplete, 'new').packages['p'], { seconds: 500, sha: 'old' })

  const complete: Part[] = [
    ...incomplete,
    { job: 'p-2', entries: [{ package: 'p', seconds: 80, exitCode: 0, shard: { index: 2, count: 2 } }] },
  ]
  assertEquals(mergeRecord(previous, complete, 'new').packages['p'], { seconds: 200, sha: 'new' })
})

const input = inputOf()

const failureRecord = {
  _tag: 'BaselineTestsFailed',
  stage: 'dryRun',
  testCount: 1,
  tests: [{
    id: 'math.test.ts > adds numbers',
    name: 'adds numbers',
    file: 'src/math.test.ts',
    location: { file: 'src/math.test.ts', line: 12, column: 3 },
    message: 'expected 3 to be 4',
    stack: null,
    reproduce: ['vitest', 'run', 'src/math.test.ts', '-t', 'adds numbers'],
  }],
  cause: [{ kind: 'AssertionError', message: 'expected 3 to be 4', stack: null }],
  capsule: { _tag: 'DoesNotReplay', why: 'interrupted', standIn: 'npx vitest run src/math.test.ts' },
  nextAction: { primary: 'fixCode', otherwise: 'fixTest' },
  traceId: null,
} as const

const failureStream = `${JSON.stringify({ _tag: 'error', schemaVersion: '3.0', code: 5, record: failureRecord })}\n`

Deno.test('buildSummary marks a report with schemaVersion and files as complete', async () => {
  const state = await loadState(
    dir,
    readFileFor({
      [`${dir}/mutation-report.json`]: '{"schemaVersion":"1.0","files":{}}',
    }),
  )
  assertStringIncludes(buildSummary(input, state), `- **Report**: **${dir}/mutation-report.json** (complete)`)
})

Deno.test('buildSummary flags a report that is not a valid Stryker report', async () => {
  const state = await loadState(
    dir,
    readFileFor({
      [`${dir}/mutation-report.json`]: '{"notReport":true}',
    }),
  )
  assertStringIncludes(buildSummary(input, state), 'not a valid Stryker report')
})

Deno.test('a terminal BaselineTestsFailed record yields a summary with the code, test location and capsule', async () => {
  const state = await loadState(dir, readFileFor({ [`${dir}/mutation-stream.jsonl`]: failureStream }))
  const summary = buildSummary(input, state)
  assertStringIncludes(summary, 'BaselineTestsFailed')
  assertStringIncludes(summary, 'src/math.test.ts:12:3')
  assertStringIncludes(summary, 'adds numbers')
  assertStringIncludes(summary, '**Replay:**')
  assertEquals(summary.includes('infrastructure'), false)
})

Deno.test('a run with neither report nor terminal record yields a RecordMissing summary naming the exit code', async () => {
  const state = await loadState(dir, readFileFor({}))
  const summary = buildSummary(inputOf({ exitCode: 6 }), state)
  assertStringIncludes(summary, 'RecordMissing')
  assertStringIncludes(summary, 'exit code: 6')
})

Deno.test('a reuse line with ran: 0 reports the evaluated-none outcome and a non-zero gate', async () => {
  const state = await loadState(
    dir,
    readFileFor({ [`${dir}/mutation-stream.jsonl`]: '{"_tag":"reuse","reused":4,"ran":0,"refused":{}}\n' }),
  )
  assertStringIncludes(buildSummary(input, state), 'evaluated no mutants')
  assertEquals(buildRequireError(input, state) !== null, true)
})

Deno.test('a failed run that reused every verdict keeps its failure outcome next to evaluated-none', async () => {
  const state = await loadState(
    dir,
    readFileFor({
      [`${dir}/mutation-report.json`]: '{"schemaVersion":"1.0","files":{}}',
      [`${dir}/mutation-stream.jsonl`]: '{"_tag":"reuse","reused":4,"ran":0,"refused":{}}\n',
    }),
  )
  assertStringIncludes(
    buildSummary(inputOf({ outcome: 'failure', exitCode: 1 }), state),
    '**failure, evaluated no mutants**',
  )
})

Deno.test('a cleared reports dir cannot satisfy the no-report gate', async () => {
  const stale = await loadState(
    dir,
    readFileFor({
      [`${dir}/mutation-report.json`]: '{"schemaVersion":"1.0","files":{}}',
    }),
  )
  assertEquals(buildRequireError(input, stale), null)

  const cleared = await loadState(dir, readFileFor({}))
  assertEquals(buildRequireError(input, cleared) !== null, true)
})

Deno.test('decodeJson rejects a malformed part meta, naming the source', () => {
  assertThrows(
    () => decodeJson(PartMetaSchema, '{"package":1,"outcome":"success"}', 'mutation-part.json'),
    Error,
    'mutation-part.json',
  )
  assertThrows(
    () => decodeJson(PartMetaSchema, '{"package":"p","outcome":"flaky"}', 'mutation-part.json'),
    Error,
    'mutation-part.json',
  )
})

Deno.test('decodeJson rejects a report without schemaVersion and preserves its other fields', () => {
  assertThrows(() => decodeJson(ReportSchema, '{"files":{}}', 'mutation-report.json'), Error, 'mutation-report.json')
  const report = decodeJson(
    ReportSchema,
    '{"schemaVersion":"1","files":{"a.ts":{}},"thresholds":{"high":80}}',
    'mutation-report.json',
  )
  assertEquals(report.thresholds, { high: 80 })
})

Deno.test('decodeJson names the JOB and JOBS env values it rejects', () => {
  assertThrows(() => decodeJson(JobOrNullSchema, '{"id":1}', 'JOB'), Error, 'JOB')
  assertThrows(() => decodeJson(JobsSchema, 'not json', 'JOBS'), Error, 'JOBS')
  assertEquals(decodeJson(JobOrNullSchema, 'null', 'JOB'), null)
})

Deno.test('decodeInput names the workspace file when packages is malformed', () => {
  assertThrows(
    () => decodeInput(PnpmWorkspaceSchema, { packages: 'test/*' }, 'pnpm-workspace.yaml'),
    Error,
    'pnpm-workspace.yaml',
  )
})

Deno.test('a passing preflight names where its coverage went, or that every shard repeats the dry run', async () => {
  const state = await loadState(dir, readFileFor({}))
  const passed = inputOf({ outcome: 'success', exitCode: 0 })
  assertStringIncludes(buildPreflightSummary(passed, state, true), `packages/x/${PREFLIGHT_FILE}`)
  assertStringIncludes(buildPreflightSummary(passed, state, false), 'every shard runs its own dry run')
  assertEquals(buildPreflightSummary(passed, state, true).includes('RecordMissing'), false)
  assertEquals(buildPreflightError(passed, state), null)
})

Deno.test('a failing preflight renders its terminal record and annotates it', async () => {
  const state = await loadState(dir, readFileFor({ [`${dir}/mutation-stream.jsonl`]: failureStream }))
  const failed = inputOf({ exitCode: 5 })
  assertStringIncludes(buildPreflightSummary(failed, state, false), 'BaselineTestsFailed')
  assertStringIncludes(buildPreflightError(failed, state) ?? '', 'BaselineTestsFailed')
})

const reuseLine = (ran: number): string => `${JSON.stringify({ _tag: 'reuse', reused: 4, ran, refused: {} })}\n`

Deno.test('evaluatedOf sums the mutants every part ran and reports evaluated-none when that sum is zero', () => {
  assertEquals(evaluatedOf([reuseLine(2), reuseLine(3), '{"_tag":"tick"}\n']), Option.some(5))
  assertStringIncludes(evaluatedSummaryOf(evaluatedOf([reuseLine(0), reuseLine(0)])), 'no mutants')
  assertEquals(evaluatedOf(['{"_tag":"tick"}\n']), Option.none())
})

const sarifOf = (
  rules: readonly string[],
  results: readonly (readonly [string, string])[],
  invocations?: unknown[],
) => ({
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
  version: '2.1.0' as const,
  runs: [{
    tool: {
      driver: {
        name: 'StrykerJS',
        version: '1',
        informationUri: 'https://stryker-mutator.io',
        rules: rules.map((id) => ({ id })),
      },
    },
    results: results.map(([ruleId, uri]) => ({
      ruleId,
      ruleIndex: rules.indexOf(ruleId),
      locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: 1 } } }],
    })),
    ...(invocations === undefined ? {} : { invocations }),
  }],
})

Deno.test('mergeSarif folds every package into one run with repository paths and re-indexed rules', () => {
  const notification = {
    descriptor: { id: 'BaselineTestsFailed' },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'src/b.test.ts' }, region: { startLine: 3 } } }],
  }
  const merged = Option.getOrThrow(mergeSarif([
    { dir: 'packages/a', log: decodeInput(SarifLogSchema, sarifOf(['Z'], [['Z', 'src/a.ts']]), 'a') },
    {
      dir: 'packages/b',
      log: decodeInput(
        SarifLogSchema,
        sarifOf(['A', 'Z'], [['A', 'src/b.ts']], [{ toolExecutionNotifications: [notification] }]),
        'b',
      ),
    },
  ]))
  const [run] = merged.runs
  assertEquals(merged.runs.length, 1)
  assertEquals(run?.tool.driver.rules.map((rule) => rule.id), ['A', 'Z'])
  assertEquals(
    run?.results.map((
      result,
    ) => [result.ruleId, result['ruleIndex'], result.locations[0]?.physicalLocation.artifactLocation.uri]),
    [['Z', 1, 'packages/a/src/a.ts'], ['A', 0, 'packages/b/src/b.ts']],
  )
  assertEquals(
    run?.invocations?.[0]?.toolExecutionNotifications?.[0]?.locations?.[0]?.physicalLocation.artifactLocation.uri,
    'packages/b/src/b.test.ts',
  )
  assertEquals(mergeSarif([]), Option.none())
})

Deno.test('mergeRecord scales a reuse-shrunk duration to the full mutant set and keeps the record when nothing ran', () => {
  const previous: TimingRecord = { version: 1, packages: { p: { seconds: 500, sha: 'old' } } }
  const scaled: Part[] = [{ job: 'p', entries: [{ package: 'p', seconds: 100, exitCode: 0, ran: 10, reused: 90 }] }]
  assertEquals(mergeRecord(previous, scaled, 'new').packages['p'], { seconds: 1000, sha: 'new' })
  const nothing: Part[] = [{ job: 'p', entries: [{ package: 'p', seconds: 20, exitCode: 0, ran: 0, reused: 100 }] }]
  assertEquals(mergeRecord(previous, nothing, 'new').packages['p'], { seconds: 500, sha: 'old' })
  assertEquals(mergeRecord(emptyRecord, nothing, 'new').packages['p'], { seconds: 20, sha: 'new' })
})
