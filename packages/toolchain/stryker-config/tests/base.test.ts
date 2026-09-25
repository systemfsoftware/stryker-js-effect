import { installedPlugin, shardMutate } from '@systemfsoftware/stryker-config'
import { afterAll, describe, it } from '@systemfsoftware/vitest'
import { Schema as S } from 'effect'
import { globSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const realTempDir = (prefix: string): string => realpathSync(mkdtempSync(join(tmpdir(), prefix)))

const root = realTempDir('stryker-config-')
afterAll(() => rmSync(root, { force: true, recursive: true }))

const filesDir = join(root, 'files')
mkdirSync(join(filesDir, 'nested'), { recursive: true })
const filePattern = `${filesDir}/**/*.ts`
for (const relative of ['a.ts', 'b.ts', 'c.ts', 'nested/d.ts', 'nested/e.ts']) {
  writeFileSync(join(filesDir, relative), '')
}

const pluginDir = join(root, 'plugin-host')
const pluginNames = ['fixture-alpha', 'fixture-beta'] as const
for (const name of pluginNames) {
  const dir = join(pluginDir, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
  writeFileSync(join(dir, 'index.js'), '')
}
const configUrl = pathToFileURL(join(pluginDir, 'stryker.config.js')).href
const installedHref = (name: string): string => pathToFileURL(join(pluginDir, 'node_modules', name, 'index.js')).href

const withShard = <A>(shard: string | undefined, body: () => A): A => {
  const previousShard = process.env['STRYKER_SHARD']
  const previousCwd = process.cwd()
  if (shard === undefined) delete process.env['STRYKER_SHARD']
  else process.env['STRYKER_SHARD'] = shard
  try {
    return body()
  } finally {
    if (previousShard === undefined) delete process.env['STRYKER_SHARD']
    else process.env['STRYKER_SHARD'] = previousShard
    if (process.cwd() !== previousCwd) process.chdir(previousCwd)
  }
}

const thrownMessage = (body: () => unknown): string => {
  try {
    body()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const messageInDir = (dir: string, shard: string): string => {
  const previousShard = process.env['STRYKER_SHARD']
  const previousCwd = process.cwd()
  process.env['STRYKER_SHARD'] = shard
  try {
    process.chdir(dir)
    return thrownMessage(() => shardMutate([filePattern]))
  } finally {
    process.chdir(previousCwd)
    if (previousShard === undefined) delete process.env['STRYKER_SHARD']
    else process.env['STRYKER_SHARD'] = previousShard
  }
}

const patterns = ['src/**/*.ts', '!src/**/*.test.ts']

describe('shardMutate', () => {
  it('keeps every pattern when STRYKER_SHARD is unset', function*({ expect }) {
    const observed = [undefined, ''].map((shard) => withShard(shard, () => shardMutate(patterns)))
    yield* expect(observed).toEqual([patterns, patterns])
  })

  it('refuses a malformed STRYKER_SHARD with the required format', function*({ expect }) {
    const observed = ['4/3', '0/4', 'nope'].map((shard) =>
      withShard(shard, () => thrownMessage(() => shardMutate(patterns)))
    )
    yield* expect(observed).toEqual(
      ['4/3', '0/4', 'nope'].map((raw) =>
        `STRYKER_SHARD must be <index>/<count> with 1 <= index <= count, got '${raw}'.`
      ),
    )
  })

  it('refuses mutation ranges, naming the offending pattern', function*({ expect }) {
    const message = withShard('1/2', () => thrownMessage(() => shardMutate(['src/a.ts:5-10', 'src/b.ts'])))
    yield* expect(message).toEqual('shardMutate cannot slice mutation ranges: src/a.ts:5-10.')
  })

  it('partitions the expanded files across every shard', function*({ expect }) {
    const expanded = globSync(filePattern).sort()
    const count = 3
    const owned = Array.from({ length: count }, (_, index) => {
      const out = withShard(`${index + 1}/${count}`, () => shardMutate([filePattern]))
      const negated = new Set(out.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1)))
      return expanded.filter((file) => !negated.has(file))
    })
    const union = [...new Set(owned.flat())].sort()
    const ownersPerFile = expanded.map((file) => owned.filter((slice) => slice.includes(file)).length)
    yield* expect({ ownersPerFile, union }).toEqual({ ownersPerFile: expanded.map(() => 1), union: expanded })
  })

  it('never negates a file when one shard owns everything', function*({ expect }) {
    const out = withShard('1/1', () => shardMutate([filePattern]))
    yield* expect(out).toEqual([filePattern])
  })

  it('names the missing package.json and the cause it hit', function*({ expect }) {
    const empty = realTempDir('stryker-config-empty-')
    const previousCwd = process.cwd()
    const previousShard = process.env['STRYKER_SHARD']
    let message = ''
    let expectedPath = ''
    process.env['STRYKER_SHARD'] = '1/2'
    try {
      process.chdir(empty)
      expectedPath = join(process.cwd(), 'package.json')
      message = thrownMessage(() => shardMutate([filePattern]))
    } finally {
      process.chdir(previousCwd)
      if (previousShard === undefined) delete process.env['STRYKER_SHARD']
      else process.env['STRYKER_SHARD'] = previousShard
    }
    yield* expect(message).toSatisfy(
      (actual: string) =>
        actual.startsWith(`shardMutate needs package.json next to the Stryker config at ${expectedPath}: `) &&
        actual.includes('ENOENT'),
      'names shardMutate, the package.json path it looked for, and the read cause',
    )
  })

  it('names an unparsable package.json and the parse cause', function*({ expect }) {
    const broken = realTempDir('stryker-config-broken-')
    writeFileSync(join(broken, 'package.json'), '{ not json')
    const expectedPrefix = `shardMutate needs package.json next to the Stryker config at ${
      join(broken, 'package.json')
    }: `
    const message = messageInDir(broken, '1/2')
    yield* expect(message).toSatisfy(
      (actual: string) => actual.startsWith(expectedPrefix) && actual.length > expectedPrefix.length,
      'names shardMutate, the package.json path it read, and the parse cause',
    )
  })
})

describe('installedPlugin', () => {
  it('resolves a specifier from the config dir node_modules', function*({ expect }) {
    const resolved = pluginNames.map((name) => installedPlugin(name, configUrl))
    yield* expect(resolved).toEqual(pluginNames.map(installedHref))
  })

  it('ignores the package self-reference in favor of the installed copy', function*({ expect }) {
    const host = join(root, 'self-ref-host')
    mkdirSync(join(host, 'node_modules', 'fixture-alpha'), { recursive: true })
    writeFileSync(join(host, 'package.json'), JSON.stringify({ name: 'fixture-alpha', exports: { '.': './own.js' } }))
    writeFileSync(join(host, 'own.js'), '')
    writeFileSync(
      join(host, 'node_modules', 'fixture-alpha', 'package.json'),
      JSON.stringify({ name: 'fixture-alpha', main: 'index.js' }),
    )
    writeFileSync(join(host, 'node_modules', 'fixture-alpha', 'index.js'), '')
    const resolved = installedPlugin('fixture-alpha', pathToFileURL(join(host, 'stryker.config.js')).href)
    yield* expect(resolved).toEqual(pathToFileURL(join(host, 'node_modules', 'fixture-alpha', 'index.js')).href)
  })

  it.prop(
    '∀ specifier: resolves the node_modules copy the config dir installed',
    {
      of: [S.Literals(pluginNames)],
      subject: (specifier: (typeof pluginNames)[number]) => installedPlugin(specifier, configUrl),
    },
    (subject, [specifier]) => subject(specifier) === installedHref(specifier),
  )
})
