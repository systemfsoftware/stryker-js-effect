import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Effect } from 'effect'
import { instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { it } from 'vitest'

const ROOT = '/home/ryan/Documents/projects/systemfsoftware/stryker-js-effect.worktrees/systemf-updates'
const OUT = process.env['A2D_CORPUS_OUT'] ?? '/tmp/refactor/printer-corpus'

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.html', '.htm', '.svelte']
const SKIP_DIRS: Record<string, true> = {
  node_modules: true,
  dist: true,
  '.turbo': true,
  temp: true,
  coverage: true,
  '.git': true,
}

const walk = (dir: string): string[] => {
  const out: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      if (SKIP_DIRS[entry] === true) continue
      const full = join(current, entry)
      if (statSync(full).isDirectory()) visit(full)
      else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full)
    }
  }
  visit(dir)
  return out
}

const INLINE_SOURCES: readonly (readonly [string, string])[] = [
  ['probe.ts', `export function price(n) {
  if (n > 10) {
    return n + 1
  }
  const label = "expensive"
  return label.length === 0 ? true : false
}`],
  ['keep.ts', `export const add = (a: number, b: number) => a + b

export const kept = keep((x: number) => x + 1)
`],
  ['region.ts', `export const add = (a: number, b: number) => a + b
if (flag) {
  const inner = 1 + 1
}
`],
  ['guard.ts', `export function gate(feature) {
  if (!feature.enabled) {
    return 'off'
  }
  return 'on'
}`],
  ['guard-optional.ts', `export function gate(feature) {
  if (!feature?.enabled) {
    return 'off'
  }
  return 'on'
}`],
  ['const-table.ts', `export const severities = {
  info: 'info',
  warning: 'warning',
  critical: 'critical',
} as const`],
  ['commented.ts', `#!/usr/bin/env node
// leading file comment
/* block lead */
export function price(n) {
  return n + 1 // trailing on return
}
`],
  ['predicate.workflow.ts', `import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

class RunInterrupted {
  readonly _tag = 'RunInterrupted' as const
}

const classify = (command: { interrupted: boolean }): RunInterrupted | { _tag: 'RunOk' } =>
  command.interrupted ? new RunInterrupted() : { _tag: 'RunOk' }

export const workflow = Workflow.make({} as never, (command) =>
  Match.value(classify(command)).pipe(
    Match.tag('RunInterrupted', (error) => Result.fail(error)),
    Match.when(
      (outcome): outcome is { _tag: 'RunOk' } => !(outcome instanceof RunInterrupted),
      (decision) => Result.succeed(decision),
    ),
    Match.exhaustive,
  ),
)
`],
  ['component.svelte', `<script>
  export let n = 1
  const big = n > 10
</script>
<p>{big}</p>
`],
  ['prototype-methods.ts', ['toString', 'valueOf', 'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']
    .map((member, index) => `export const v${index} = String(globalThis).${member}()`)
    .join('\n')],
  ['regex-corpus.ts', [
    ['^abc$', ''], ['^abc', ''], ['abc$', ''], ['^', ''], ['$', ''], ['^$', ''],
    ['[abc]', ''], ['[^abc]', ''], ['[a-z]', ''], ['^\\d{3}-\\d{4}$', ''], ['^[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}$', ''],
    ['^https?:\\/\\/[^\\s]+$', ''], ['\\s*([A-Z][a-z]+)\\s*', ''], ['(?<year>\\d{4})-(?<month>\\d{2})', ''],
    ['\\bfoo\\b', ''], ['a|b|c', ''], ['.*', ''], ['[]', ''],
  ].map(([pattern, flags], index) => `export const v${index} = /${pattern}/${flags}`).join('\n')],
]

const slugOf = (path: string): string => relative(ROOT, path).replace(/[^a-zA-Z0-9._-]/g, '_')

const isPrinterSource = (path: string): boolean =>
  /stryker-js-instrumenter[\\/]src[\\/](print[\\/]|Printer\.ts$)/.test(path)

type Captured = { readonly ok: true; readonly content: string } | { readonly ok: false }

const runOne = async (name: string, content: string, mutate: boolean): Promise<Captured> => {
  const exit = await Effect.runPromiseExit(
    instrument([{ name, content, mutate }], { ignorers: [], excludedMutations: [] }),
  )
  return exit._tag === 'Success' && exit.value.files.length > 0
    ? { ok: true, content: exit.value.files[0]?.content ?? '' }
    : { ok: false }
}

it('captures the printer corpus', async () => {
  mkdirSync(join(OUT, 'plain'), { recursive: true })
  mkdirSync(join(OUT, 'instrumented'), { recursive: true })

  const files = [
    ...walk(join(ROOT, 'test/e2e/testResources')),
    ...walk(join(ROOT, 'packages/stryker-js-instrumenter/src')),
    ...walk(join(ROOT, 'packages/stryker-js/src')),
  ].filter((file) => isPrinterSource(file) === false)

  const failures: string[] = []
  const manifest: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const slug = slugOf(file)
    const plain = await runOne(file, text, false)
    if (plain.ok) {
      writeFileSync(join(OUT, 'plain', `${slug}.txt`), plain.content)
      manifest.push(slug)
    } else {
      failures.push(`plain ${slug}`)
    }
    const mutated = await runOne(file, text, true)
    if (mutated.ok) {
      writeFileSync(join(OUT, 'instrumented', `${slug}.txt`), mutated.content)
    } else {
      failures.push(`instrumented ${slug}`)
    }
  }

  for (const [name, content] of INLINE_SOURCES) {
    const slug = `inline_${name}`
    const plain = await runOne(name, content, false)
    if (plain.ok) {
      writeFileSync(join(OUT, 'plain', `${slug}.txt`), plain.content)
      manifest.push(slug)
    } else {
      failures.push(`plain ${slug}`)
    }
    const mutated = await runOne(name, content, true)
    if (mutated.ok) {
      writeFileSync(join(OUT, 'instrumented', `${slug}.txt`), mutated.content)
    } else {
      failures.push(`instrumented ${slug}`)
    }
  }

  writeFileSync(join(OUT, 'manifest.txt'), `${[...manifest].sort().join('\n')}\n`)
  writeFileSync(join(OUT, 'failures.txt'), `${[...failures].sort().join('\n')}\n`)
  writeFileSync(join(OUT, 'counts.txt'), `files=${files.length} inline=${INLINE_SOURCES.length}\n`)
  const inputHashes = files.map((file) => `${slugOf(file)} ${createHash('sha256').update(readFileSync(file)).digest('hex')}`)
  writeFileSync(join(OUT, 'inputs.sha256'), `${[...inputHashes].sort().join('\n')}\n`)
})
