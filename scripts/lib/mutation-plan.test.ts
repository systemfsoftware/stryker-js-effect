import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'

import {
  buildRequireError,
  combineParts,
  emptyRecord,
  loadState,
  mergeRecord,
  type Part,
  planJobs,
  type StagedPart,
  type TimingRecord,
} from './mutation-plan.ts'

const readFileFor = (files: Record<string, string>) => (path: string): Promise<string> =>
  path in files ? Promise.resolve(files[path]) : Promise.reject(new Error(`no such file: ${path}`))

const dir = 'packages/x/reports'

Deno.test('a package whose reports dir has no report requires one, with or without stream mutants', async () => {
  const base = { package: 'packages/x', outcome: 'failure', reportsDir: dir }

  const empty = readFileFor({})
  const zero = buildRequireError({ ...base, readFile: empty }, await loadState(dir, empty))
  assertStringIncludes(zero ?? '', 'zero mutant results')

  const streaming = readFileFor({
    [`${dir}/mutation-stream.jsonl`]: '{"_tag":"phase"}\n{"_tag":"mutant","id":"m1"}\n{"_tag":"mutant","id":"m2"}\n',
  })
  const partial = buildRequireError({ ...base, readFile: streaming }, await loadState(dir, streaming))
  assertStringIncludes(partial ?? '', 'after 2 completed mutant(s)')

  const complete = readFileFor({ [`${dir}/mutation-report.json`]: '{"schemaVersion":"1.0","files":{}}' })
  assertEquals(buildRequireError({ ...base, readFile: complete }, await loadState(dir, complete)), null)
})

const shardPart = (index: number, files: string[]): StagedPart => ({
  meta: { package: 'packages/x', outcome: 'success', shard: { index, count: 2 } },
  report: { files: Object.fromEntries(files.map((file) => [file, {}])) },
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
