import type { Ignorer, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { type IgnorerCases, testIgnorer } from '@systemfsoftware/stryker-ignorer-kit/tester'
import { describe, expect, it } from 'vitest'

type TextLiteral = Extract<Node, { readonly type: 'Literal' }> & { readonly value: string }

function isTextLiteral(node: Node): node is TextLiteral {
  return node.type === 'Literal' && typeof node.value === 'string'
}

function textLiteralReason(node: Node): string | undefined {
  return isTextLiteral(node) ? 'STR' : undefined
}

const stringsIgnored: Ignorer = {
  name: 'strings-ignored',
  shouldIgnore: textLiteralReason,
}

const nothingIgnored: Ignorer = {
  name: 'nothing-ignored',
  shouldIgnore: () => undefined,
}

// Top-level on purpose: runner globals only collect during module evaluation, so the
// registered suite below becomes real tests of this file.
await testIgnorer(stringsIgnored, {
  kept: [{ name: 'ordinary code', code: 'const a = 1' }],
  ignored: [
    { name: 'text-only expectation', code: 'foo("bar")', ignores: ['"bar"'] },
    { name: 'reason-pinned expectation', code: 'foo("bar")', ignores: [{ text: '"bar"', reason: 'STR' }] },
  ],
})

type DescribeFn = (name: string, fn: () => void) => void
type ItFn = (name: string, fn: () => Promise<void>) => void

function globalFn(name: string): unknown {
  return Reflect.get(globalThis, name)
}

function setGlobal(name: string, value: unknown): void {
  Reflect.set(globalThis, name, value)
}

function savedRunner(): { describe: unknown; it: unknown } {
  return { describe: globalFn('describe'), it: globalFn('it') }
}

async function withGlobals(
  globals: { readonly describe: unknown; readonly it: unknown },
  run: () => Promise<void>,
): Promise<void> {
  const saved = savedRunner()
  setGlobal('describe', globals.describe)
  setGlobal('it', globals.it)
  try {
    await run()
  } finally {
    setGlobal('describe', saved.describe)
    setGlobal('it', saved.it)
  }
}

async function withoutRunner(run: () => Promise<void>): Promise<void> {
  await withGlobals({ describe: undefined, it: undefined }, run)
}

function recordingDescribe(mark: () => void): DescribeFn {
  return (_name, fn) => {
    mark()
    fn()
  }
}

interface ResolvesRow {
  readonly name: string
  readonly cases: IgnorerCases
}

const resolvesRows: ResolvesRow[] = [
  {
    name: 'repeated identical expectations each consume a distinct span',
    cases: { ignored: [{ name: 'multiset', code: 'foo("x", "x")', ignores: ['"x"', '"x"'] }] },
  },
  {
    name: 'ignored spans beyond the named expectations do not fail the case',
    cases: { ignored: [{ name: 'containment', code: 'foo("a", "b")', ignores: ['"a"'] }] },
  },
  {
    name: 'a keeps expectation passes when the named span stays live beside ignored siblings',
    cases: { ignored: [{ name: 'sibling ignored', code: 'foo("a", 1)', ignores: ['"a"'], keeps: ['1'] }] },
  },
  {
    name: 'a per-case lang override parses the snippet as that language',
    cases: { kept: [{ name: 'ts syntax as ts', code: 'const a: number = 1', lang: 'ts' }] },
  },
]

interface RejectsRow {
  readonly name: string
  readonly subject: Ignorer
  readonly cases: IgnorerCases
  readonly pattern: RegExp
}

const sabotageCases: IgnorerCases = { kept: [{ name: 'sabotage', code: 'foo("bar")' }] }
const rejectsRows: RejectsRow[] = [
  {
    name: 'a kept case fails listing received spans with reasons when the subject ignores something',
    subject: stringsIgnored,
    cases: sabotageCases,
    pattern: /expected nothing ignored, received 1 span\(s\)[\s\S]*\(Literal\) reason "STR"/,
  },
  {
    name: 'an ignored case fails when an expected span is not ignored, showing expected versus received',
    subject: stringsIgnored,
    cases: { ignored: [{ name: 'missing', code: 'foo(1)', ignores: ['"nope"'] }] },
    pattern: /case "missing" \(ignored\) failed:[\s\S]*was not ignored[\s\S]*received ignored spans:\n- none/,
  },
  {
    name: 'an ignored case fails when a span reason differs from the pinned reason',
    subject: stringsIgnored,
    cases: { ignored: [{ name: 'wrong reason', code: 'foo("bar")', ignores: [{ text: '"bar"', reason: 'OTHER' }] }] },
    pattern: /with reason "OTHER" was not ignored[\s\S]*reason "STR"/,
  },
  {
    name: 'repeated identical expectations overflow when the snippet holds too few spans',
    subject: stringsIgnored,
    cases: { ignored: [{ name: 'multiset overflow', code: 'foo("x")', ignores: ['"x"', '"x"'] }] },
    pattern: /was not ignored/,
  },
  {
    name: 'a keeps expectation fails when the named span is ignored',
    subject: stringsIgnored,
    cases: { kept: [{ name: 'kept span ignored', code: 'foo("bar")', keeps: ['"bar"'] }] },
    pattern: /to stay live, but it was ignored/,
  },
  {
    name: 'a snippet that does not parse fails carrying the case name and code',
    subject: nothingIgnored,
    cases: { kept: [{ name: 'broken', code: 'const a = =' }] },
    pattern: /case "broken" \(kept\) failed:[\s\S]*const a = =[\s\S]*parse failed/,
  },
  {
    name: 'a per-case lang override rejects syntax of another language',
    subject: nothingIgnored,
    cases: { kept: [{ name: 'ts syntax as js', code: 'const a: number = 1', lang: 'js' }] },
    pattern: /parse failed/,
  },
  {
    name: 'with no runner globals one error enumerates every failing case',
    subject: stringsIgnored,
    cases: {
      kept: [{ name: 'first failure', code: 'foo("a")' }],
      ignored: [{ name: 'second failure', code: 'foo(1)', ignores: ['"nope"'] }],
    },
    pattern: /case "first failure" \(kept\) failed:[\s\S]*case "second failure" \(ignored\) failed:/,
  },
  {
    name: 'cases with identical snippets and different expectations produce independent outcomes',
    subject: stringsIgnored,
    cases: {
      ignored: [
        { name: 'right expectation', code: 'foo("x")', ignores: ['"x"'] },
        { name: 'wrong expectation', code: 'foo("x")', ignores: ['"y"'] },
      ],
    },
    pattern: /case "wrong expectation" \(ignored\) failed:(?![\s\S]*case "right expectation" \(ignored\) failed:)/,
  },
]

interface RunnerRow {
  readonly name: string
  readonly it: unknown
}

const runnerRows: RunnerRow[] = [
  { name: 'runs cases directly when describe exists but it does not', it: undefined },
  { name: 'runs cases directly when it exists but is not callable', it: 42 },
]

describe('testIgnorer without runner globals', () => {
  it.each(resolvesRows)('$name', async (row) => {
    await withoutRunner(async () => {
      await expect(testIgnorer(stringsIgnored, row.cases)).resolves.toBeUndefined()
    })
  })

  it.each(rejectsRows)('$name', async (row) => {
    await withoutRunner(async () => {
      await expect(testIgnorer(row.subject, row.cases)).rejects.toThrow(row.pattern)
    })
  })

  it('a recording subject sees ancestors excluding the node itself, nearest-first', async () => {
    let captured: readonly Node[] | undefined
    const recorder: Ignorer = {
      name: 'recorder',
      shouldIgnore: (node, ancestors) => {
        if (!isTextLiteral(node)) return undefined
        captured = ancestors
        return 'R'
      },
    }
    await withoutRunner(async () => {
      await expect(testIgnorer(recorder, {
        ignored: [{ name: 'ancestors', code: 'if (a) { foo("x") }', ignores: [{ text: '"x"', reason: 'R' }] }],
      })).resolves.toBeUndefined()
    })
    if (captured === undefined) {
      throw new Error('recorder never consulted')
    }
    expect(captured.map((one) => one.type)).toEqual([
      'CallExpression',
      'ExpressionStatement',
      'BlockStatement',
      'IfStatement',
      'Program',
    ])
  })
})

describe('testIgnorer registration', () => {
  it('registers one test per case under the subject name; a sabotage case fails alone', async () => {
    let suite: string | undefined
    const titles: string[] = []
    let greenFn: (() => Promise<void>) | undefined
    let redFn: (() => Promise<void>) | undefined
    const stubDescribe: DescribeFn = (name, fn) => {
      suite = name
      fn()
    }
    const stubIt: ItFn = (name, fn) => {
      titles.push(name)
      if (name === 'sibling stays green') greenFn = fn
      if (name === 'sabotage goes red') redFn = fn
    }
    await withGlobals({ describe: stubDescribe, it: stubIt }, async () => {
      await testIgnorer(stringsIgnored, {
        kept: [{ name: 'sibling stays green', code: 'const a = 1' }],
        ignored: [{ name: 'sabotage goes red', code: 'foo(1)', ignores: ['"nope"'] }],
      })
    })
    expect(suite).toBe('strings-ignored')
    expect(titles).toEqual(['sibling stays green', 'sabotage goes red'])
    if (greenFn === undefined || redFn === undefined) {
      throw new Error('registration missing')
    }
    await expect(greenFn()).resolves.toBeUndefined()
    await expect(redFn()).rejects.toThrow(/was not ignored/)
  })
})

describe('testIgnorer runner detection', () => {
  it.each(runnerRows)('$name', async (row) => {
    let registered = false
    await withGlobals({
      describe: recordingDescribe(() => {
        registered = true
      }),
      it: row.it,
    }, async () => {
      await expect(testIgnorer(stringsIgnored, sabotageCases))
        .rejects.toThrow(/expected nothing ignored, received 1 span\(s\)/)
    })
    expect(registered).toBe(false)
  })
})
