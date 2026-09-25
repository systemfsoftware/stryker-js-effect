import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'

import {
  buildRequireError,
  buildSummary,
  combineParts,
  decodeInput,
  decodeJson,
  emptyRecord,
  JobOrNullSchema,
  JobsSchema,
  loadState,
  mergeRecord,
  type Part,
  PartMetaSchema,
  planJobs,
  PnpmWorkspaceSchema,
  ReportSchema,
  type StagedPart,
  type TimingRecord,
} from './mutation-plan.ts'

const readFileFor = (files: Record<string, string>) => (path: string): Promise<string> =>
  path in files ? Promise.resolve(files[path]) : Promise.reject(new Error(`no such file: ${path}`))

const dir = 'packages/x/reports'

Deno.test('a package whose reports dir has no report requires one, with or without stream mutants', async () => {
  const base = { package: 'packages/x', outcome: 'failure', reportsDir: dir } as const

  const empty = readFileFor({})
  const zero = buildRequireError(base, await loadState(dir, empty))
  assertStringIncludes(zero ?? '', 'zero mutant results')

  const streaming = readFileFor({
    [`${dir}/mutation-stream.jsonl`]: '{"_tag":"phase"}\n{"_tag":"mutant","id":"m1"}\n{"_tag":"mutant","id":"m2"}\n',
  })
  const partial = buildRequireError(base, await loadState(dir, streaming))
  assertStringIncludes(partial ?? '', 'after 2 completed mutant(s)')

  const complete = readFileFor({ [`${dir}/mutation-report.json`]: '{"schemaVersion":"1.0","files":{}}' })
  assertEquals(buildRequireError(base, await loadState(dir, complete)), null)
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

const input = { package: 'packages/x', outcome: 'failure', reportsDir: dir } as const

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

Deno.test('buildSummary reports zero mutants when there is no report and no stream', async () => {
  const state = await loadState(dir, readFileFor({}))
  assertStringIncludes(buildSummary(input, state), 'zero completed mutants')
})

Deno.test('buildSummary counts completed mutants from a partial stream', async () => {
  const state = await loadState(
    dir,
    readFileFor({
      [`${dir}/mutation-stream.jsonl`]: '{"_tag":"mutant","id":"m1"}\n{"_tag":"phase"}\n{"_tag":"mutant","id":"m2"}\n',
    }),
  )
  assertStringIncludes(buildSummary(input, state), '2 completed mutant(s)')
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
  assertStringIncludes(buildRequireError(input, cleared) ?? '', 'zero mutant results')
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
