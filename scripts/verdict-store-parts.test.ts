import fc from 'fast-check'
import {
  annotationOf,
  isEntryPath,
  mergeOf,
  mergeSummaryOf,
  type PartListing,
  type Plan,
  plannedShardOf,
  type RefusalCode,
  slugOf,
  stagedOf,
  stageSummaryOf,
  STORE_DIRECTORY,
  storeKeyOf,
} from './verdict-store-parts.ts'

const SCHEME = 'verdict-key-1+sha256+mutant-id-sha256'
const PROJECTS = ['packages/stryker-js', 'test/e2e-core']

const hex = (length: number) => fc.stringMatching(new RegExp(`^[0-9a-f]{${length}}$`))
const mutantId = hex(16)
const entryName = fc.tuple(fc.constantFrom('tested', 'checker'), hex(64)).map(([kind, key]) => `${kind}-${key}.json`)
const entryOf = (id: string, name: string): string => `${SCHEME}/${id}/${name}`
const strayName = fc.oneof(
  entryName.map((name) => `.${name}.0a1b2c3d.tmp`),
  fc.constantFrom('notes.txt', 'tested-abc.json', 'checker.json', 'tested-.json'),
)

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const sameSet = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index])

const planOf = (assignments: ReadonlyArray<ReadonlyArray<string>>): Plan => ({
  shards: assignments.map((mutants, index) => ({
    index: index + 1,
    count: assignments.length,
    projects: [{ project: PROJECTS[0] ?? '', mutants }],
  })),
})

const slugAt = (plan: Plan, index: number): string => {
  const shard = plan.shards[index]
  return shard === undefined ? '' : slugOf(`${shard.index}/${shard.count}`)
}

const repoPathOf = (storeRelative: string, project = PROJECTS[0] ?? ''): string =>
  `${project}/${STORE_DIRECTORY}/${storeRelative}`

Deno.test('a shard stages every entry under its planned mutants and nothing else', () => {
  fc.assert(fc.property(
    fc.uniqueArray(mutantId, { minLength: 2, maxLength: 8 }),
    fc.nat(),
    fc.array(entryName, { minLength: 1, maxLength: 4 }),
    fc.array(strayName, { maxLength: 3 }),
    (ids, cut, names, strays) => {
      const split = 1 + (cut % (ids.length - 1))
      const own = ids.slice(0, split)
      const listing = ids.flatMap((id) => [...new Set([...names, ...strays])].map((name) => entryOf(id, name)))
      const staged = stagedOf(own, listing)
      const expected = own.flatMap((id) => [...new Set(names)].map((name) => entryOf(id, name)))
      const expectedSkipped = own.flatMap((id) => [...new Set(strays)].map((name) => entryOf(id, name)))
      assert(sameSet(staged.entries, expected), `staged ${staged.entries} expected ${expected}`)
      assert(sameSet(staged.skipped, expectedSkipped), `skipped ${staged.skipped} expected ${expectedSkipped}`)
    },
  ))
})

Deno.test('a temp file left by a killed put is never an entry', () => {
  fc.assert(fc.property(mutantId, strayName, (id, name) => {
    assert(!isEntryPath(entryOf(id, name)), `${name} read as an entry`)
    assert(stagedOf([id], [entryOf(id, name)]).entries.length === 0, `${name} was staged`)
  }))
})

Deno.test('merge keeps every carried entry once, with the bytes of the last part in plan order', () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 5 }),
    fc.array(fc.tuple(mutantId, entryName, fc.array(fc.nat({ max: 4 }), { minLength: 1, maxLength: 5 })), {
      maxLength: 12,
    }),
    (shardCount, carried) => {
      const plan = planOf(Array.from({ length: shardCount }, () => []))
      const carriersOf = carried.map(([id, name, shards]) =>
        [repoPathOf(entryOf(id, name)), [...new Set(shards.map((shard) => shard % shardCount))]] as const
      )
      const parts = new Map<string, PartListing>(
        Array.from({ length: shardCount }, (_, index) => [
          slugAt(plan, index),
          {
            files: [...new Set(carriersOf.filter(([, shards]) => shards.includes(index)).map(([file]) => file))],
            markedShard: undefined,
          },
        ]),
      )
      const merged = mergeOf(plan, PROJECTS, parts)
      if (!merged.ok) throw new Error(`refused: ${merged.refusal.code}`)
      const byFile = new Map<string, number[]>()
      for (const [file, shards] of carriersOf) byFile.set(file, [...new Set([...(byFile.get(file) ?? []), ...shards])])
      assert(merged.value.winners.length === byFile.size, 'an entry was dropped or duplicated')
      for (const [file, slug] of merged.value.winners) {
        const last = Math.max(...(byFile.get(file) ?? []))
        assert(slug === slugAt(plan, last), `${file} won from ${slug}, not the last carrier ${slugAt(plan, last)}`)
      }
      const collided = [...byFile.entries()].filter(([, shards]) => shards.length > 1).map(([file]) => file)
      assert(sameSet(merged.value.collisions, collided), `collisions ${merged.value.collisions} expected ${collided}`)
    },
  ))
})

Deno.test('a planned shard with no part is reported missing, and zero parts merge nothing', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 6 }), fc.nat(), (shardCount, seed) => {
    const plan = planOf(Array.from({ length: shardCount }, () => []))
    const present = Array.from({ length: shardCount }, (_, index) => index).filter((index) => (seed >> index) % 2 === 1)
    const parts = new Map<string, PartListing>(
      present.map((index) => [slugAt(plan, index), { files: [], markedShard: `${index + 1}/${shardCount}` }]),
    )
    const merged = mergeOf(plan, PROJECTS, parts)
    if (!merged.ok) throw new Error(`refused: ${merged.refusal.code}`)
    const absent = plan.shards.map((_, index) => index).filter((index) => !present.includes(index))
    assert(sameSet(merged.value.missing, absent.map((index) => slugAt(plan, index))), 'missing shards misreported')
    assert(merged.value.winners.length === 0, 'empty parts produced entries')
  }))
})

Deno.test('a part file outside a mutated project store refuses the whole merge', () => {
  const outside = fc.oneof(
    fc.tuple(mutantId, entryName).map(([id, name]) => repoPathOf(entryOf(id, name), 'packages/unplanned')),
    fc.tuple(mutantId, strayName).map(([id, name]) => repoPathOf(entryOf(id, name))),
    fc.tuple(mutantId, entryName).map(([id, name]) => `../${repoPathOf(entryOf(id, name))}`),
    fc.constantFrom('.github/workflows/mutation.yml', `${PROJECTS[0]}/${STORE_DIRECTORY}/x/../../../../package.json`),
  )
  fc.assert(fc.property(fc.tuple(mutantId, entryName), outside, ([id, name], bad) => {
    const plan = planOf([[], []])
    const parts = new Map<string, PartListing>([
      [slugAt(plan, 0), { files: [repoPathOf(entryOf(id, name))], markedShard: undefined }],
      [slugAt(plan, 1), { files: [bad], markedShard: undefined }],
    ])
    const merged = mergeOf(plan, PROJECTS, parts)
    assert(!merged.ok && merged.refusal.code === 'VERDICT_PART_OUTSIDE_STORE', `${bad} was not refused`)
  }))
})

Deno.test('a part the plan does not name, or one marked for another shard, refuses the merge', () => {
  const plan = planOf([[], []])
  const extra = mergeOf(plan, PROJECTS, new Map([['3of2', { files: [], markedShard: undefined }]]))
  assert(!extra.ok && extra.refusal.code === 'VERDICT_PART_UNPLANNED', 'an unplanned part merged')
  const mismarked = mergeOf(plan, PROJECTS, new Map([[slugAt(plan, 0), { files: [], markedShard: '2/2' }]]))
  assert(!mismarked.ok && mismarked.refusal.code === 'VERDICT_PART_UNPLANNED', 'a mismarked part merged')
})

Deno.test('the store key ignores listing order and changes with any path or byte digest', () => {
  const digest = fc.record({
    path: fc.tuple(mutantId, entryName).map(([id, name]) => repoPathOf(entryOf(id, name))),
    sha256: hex(64),
  })
  fc.assert(fc.property(
    fc.uniqueArray(digest, { minLength: 1, maxLength: 8, selector: (entry) => entry.path }),
    fc.nat(),
    hex(64),
    (digests, at, other) => {
      const key = storeKeyOf(digests)
      assert(key === storeKeyOf([...digests].reverse()), 'the key depends on listing order')
      const index = at % digests.length
      const target = digests[index]
      if (target === undefined) return
      if (other !== target.sha256) {
        const changed = digests.with(index, { ...target, sha256: other })
        assert(storeKeyOf(changed) !== key, 'a changed entry kept the key')
      }
      const renamed = digests.with(index, { ...target, path: `${target.path}.moved` })
      assert(storeKeyOf(renamed) !== key, 'a moved entry kept the key')
      assert(storeKeyOf(digests.toSpliced(index, 1)) !== key, 'a dropped entry kept the key')
    },
  ))
  assert(storeKeyOf([]) === '', 'an empty store has a key')
})

Deno.test('a shard name the plan does not hold is refused with a reason code', () => {
  const plan = planOf([[], []])
  const found = plannedShardOf(plan, '2/2')
  assert(found.ok && found.value.index === 2, 'a planned shard was not found')
  const absent = plannedShardOf(plan, '3/2')
  assert(!absent.ok && absent.refusal.code === 'PLAN_SHARD_ABSENT', 'an unplanned shard was accepted')
})

const lineOf = (summary: string, prefix: string): string =>
  summary.split('\n').find((line) => line.startsWith(prefix)) ?? ''

Deno.test('a stage summary tells an absent store directory apart from a store holding no entry of the shard', () => {
  const stagedProject = fc.record({
    storeFound: fc.boolean(),
    entries: fc.nat({ max: 3 }),
    skipped: fc.nat({ max: 2 }),
  })
  fc.assert(fc.property(fc.array(stagedProject, { minLength: 1, maxLength: 4 }), (generated) => {
    const staged = generated.map(({ storeFound, entries, skipped }, index) => ({
      project: `packages/p${index}`,
      storeFound,
      part: {
        entries: Array.from({ length: storeFound ? entries : 0 }, (_, at) => `e${at}`),
        skipped: Array.from({ length: storeFound ? skipped : 0 }, (_, at) => `s${at}`),
      },
    }))
    const summary = stageSummaryOf('2/3', staged)
    const absent = staged.filter(({ storeFound }) => !storeFound).map(({ project }) => project)
    const found = lineOf(summary, '- store directories found:')
    assert(
      found.startsWith(`- store directories found: ${staged.length - absent.length} of ${staged.length} `),
      found,
    )
    assert(absent.every((project) => found.includes(project)), `${found} does not name every absent store`)
    for (const { project, part } of staged) {
      assert(lineOf(summary, `- \`${project}\`: ${part.entries.length} entr`) !== '', `${project} count missing`)
    }
    const none = staged.every(({ part }) => part.entries.length === 0)
    const predates = summary.includes('a CLI that predates the store writes none')
    const emptyStore = summary.includes("No store entry belongs to this shard's mutants.")
    assert(predates === (none && absent.length === staged.length), 'the absent-store note is misplaced')
    assert(emptyStore === (none && absent.length < staged.length), 'the empty-store note is misplaced')
  }))
})

Deno.test('a merge summary counts the parts, names each missing shard and shows the key it saves under', () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 5 }),
    fc.nat(),
    fc.array(fc.tuple(mutantId, entryName), { maxLength: 4 }),
    (shardCount, seed, carried) => {
      const plan = planOf(Array.from({ length: shardCount }, () => []))
      const present = plan.shards.map((_, index) => index).filter((index) => (seed >> index) % 2 === 1)
      const files = carried.map(([id, name]) => repoPathOf(entryOf(id, name)))
      const parts = new Map<string, PartListing>(
        present.map((index) => [slugAt(plan, index), { files, markedShard: undefined }]),
      )
      const merged = mergeOf(plan, PROJECTS, parts)
      if (!merged.ok) throw new Error(`refused: ${merged.refusal.code}`)
      const key = files.length === 0 ? '' : storeKeyOf([{ path: files[0] ?? '', sha256: '0'.repeat(64) }])
      const summary = mergeSummaryOf(merged.value, shardCount, { entries: 0, bytes: 0, key })
      const partsLine = lineOf(summary, '- parts merged:')
      assert(partsLine.startsWith(`- parts merged: ${present.length} of ${shardCount} shards planned`), partsLine)
      assert(merged.value.missing.every((slug) => partsLine.includes(slug)), `${partsLine} hides a missing shard`)
      const collisions = lineOf(summary, '- collisions')
      assert(collisions.endsWith(`: ${merged.value.collisions.length}`), collisions)
      const keyLine = lineOf(summary, '- cache key:')
      assert(key === '' ? keyLine.includes('none') : keyLine.includes(`\`${key}\``), keyLine)
    },
  ))
})

const COMMAND = /^::error title=([A-Z_]+)::(.*)$/u

const unescapeCommandData = (data: string): string =>
  data.replace(/%(25|0D|0A)/gu, (_, code: string) => ({ '25': '%', '0D': '\r', '0A': '\n' })[code] ?? '')

Deno.test('a refusal annotation is one workflow command naming its code, whatever its message holds', () => {
  const code = fc.constantFrom<RefusalCode>('PLAN_UNREADABLE', 'SHARD_STORE_UNREADABLE', 'MERGED_STORE_UNREADABLE')
  const text = fc.string({ unit: fc.constantFrom('a', ' ', '%', '0', 'A', '\n', '\r', ':', ',') })
  fc.assert(fc.property(code, text, text, (refusalCode, message, next) => {
    const annotation = annotationOf({ code: refusalCode, message, next })
    const parsed = COMMAND.exec(annotation)
    assert(parsed !== null, `${JSON.stringify(annotation)} is not one workflow command line`)
    assert(parsed?.[1] === refusalCode, `titled ${parsed?.[1]}, not ${refusalCode}`)
    assert(unescapeCommandData(parsed?.[2] ?? '') === `${message}. Next: ${next}`, 'the message did not round-trip')
  }))
})
