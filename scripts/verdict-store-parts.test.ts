import fc from 'fast-check'
import {
  isEntryPath,
  mergeOf,
  type PartListing,
  type Plan,
  plannedShardOf,
  slugOf,
  stagedOf,
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
      const listing = ids.flatMap((id) => [...names, ...strays].map((name) => entryOf(id, name)))
      const staged = stagedOf(own, listing)
      const expected = own.flatMap((id) => [...new Set(names)].map((name) => entryOf(id, name)))
      assert(sameSet([...new Set(staged.entries)], expected), `staged ${staged.entries} expected ${expected}`)
      assert(staged.entries.every(isEntryPath), 'a staged file is not an entry')
      assert(
        staged.entries.every((file) => own.some((id) => file.startsWith(`${SCHEME}/${id}/`))),
        "another shard's mutant was staged",
      )
      assert(staged.skipped.every((file) => !isEntryPath(file)), 'an entry was counted as skipped')
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
