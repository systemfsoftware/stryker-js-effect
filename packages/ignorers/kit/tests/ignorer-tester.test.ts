import type { Ignorer, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { testIgnorer } from '@systemfsoftware/stryker-ignorer-kit/tester'
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

async function withoutRunner(run: () => Promise<void>): Promise<void> {
  const saved = savedRunner()
  setGlobal('describe', undefined)
  setGlobal('it', undefined)
  try {
    await run()
  } finally {
    setGlobal('describe', saved.describe)
    setGlobal('it', saved.it)
  }
}

describe('testIgnorer without runner globals', () => {
  it('a kept case fails listing received spans with reasons when the subject ignores something', async () => {
    await withoutRunner(async () => {
      await expect(testIgnorer(stringsIgnored, { kept: [{ name: 'sabotage', code: 'foo("bar")' }] }))
        .rejects.toThrow(/expected nothing ignored, received 1 span\(s\)[\s\S]*\(Literal\) reason "STR"/)
    })
  })

  it('an ignored case fails when an expected span is not ignored, showing expected versus received', async () => {
    await withoutRunner(async () => {
      await expect(testIgnorer(stringsIgnored, {
        ignored: [{ name: 'missing', code: 'foo(1)', ignores: ['"nope"'] }],
      })).rejects.toThrow(
        /case "missing" \(ignored\) failed:[\s\S]*was not ignored[\s\S]*received ignored spans:\n- none/,
      )
    })
  })

  it('an ignored case fails when a span reason differs from the pinned reason', async () => {
    await withoutRunner(async () => {
      await expect(testIgnorer(stringsIgnored, {
        ignored: [{ name: 'wrong reason', code: 'foo("bar")', ignores: [{ text: '"bar"', reason: 'OTHER' }] }],
      })).rejects.toThrow(/with reason "OTHER" was not ignored[\s\S]*reason "STR"/)
    })
  })

  it('repeated identical text expectations each consume a distinct span', async () => {
    await withoutRunner(async () => {
      await expect(testIgnorer(stringsIgnored, {
        ignored: [{ name: 'multiset', code: 'foo("x", "x")', ignores: ['"x"', '"x"'] }],
      })).resolves.toBeUndefined()
      await expect(testIgnorer(stringsIgnored, {
        ignored: [{ name: 'multiset overflow', code: 'foo("x")', ignores: ['"x"', '"x"'] }],
      })).rejects.toThrow(/was not ignored/)
    })
  })

  it('ignored spans beyond the named expectations do not fail the case', async () => {
    await withoutRunner(async () => {
      await expect(testIgnorer(stringsIgnored, {
        ignored: [{ name: 'containment', code: 'foo("a", "b")', ignores: ['"a"'] }],
      })).resolves.toBeUndefined()
    })
  })

  it('a keeps expectation passes when the named span stays live beside ignored siblings', async () => {
    await withoutRunner(async () => {
      await expect(testIgnorer(stringsIgnored, {
        ignored: [{ name: 'sibling ignored', code: 'foo("a", 1)', ignores: ['"a"'], keeps: ['1'] }],
      })).resolves.toBeUndefined()
    })
  })

  it('a keeps expectation fails when the named span is ignored', async () => {
    await withoutRunner(async () => {
      await expect(testIgnorer(stringsIgnored, {
        kept: [{ name: 'kept span ignored', code: 'foo("bar")', keeps: ['"bar"'] }],
      })).rejects.toThrow(/to stay live, but it was ignored/)
    })
  })

  it('a snippet that does not parse fails carrying the case name and code', async () => {
    await withoutRunner(async () => {
      await expect(testIgnorer(nothingIgnored, {
        kept: [{ name: 'broken', code: 'const a = =' }],
      })).rejects.toThrow(/case "broken" \(kept\) failed:[\s\S]*const a = =[\s\S]*parse failed/)
    })
  })

  it('a per-case lang override parses the snippet as that language', async () => {
    await withoutRunner(async () => {
      await expect(testIgnorer(nothingIgnored, {
        kept: [{ name: 'ts syntax as js', code: 'const a: number = 1', lang: 'js' }],
      })).rejects.toThrow(/parse failed/)
      await expect(testIgnorer(nothingIgnored, {
        kept: [{ name: 'ts syntax as ts', code: 'const a: number = 1', lang: 'ts' }],
      })).resolves.toBeUndefined()
    })
  })

  it('with no runner globals one error enumerates every failing case', async () => {
    await withoutRunner(async () => {
      await expect(testIgnorer(stringsIgnored, {
        kept: [{ name: 'first failure', code: 'foo("a")' }],
        ignored: [{ name: 'second failure', code: 'foo(1)', ignores: ['"nope"'] }],
      })).rejects.toThrow(/case "first failure" \(kept\) failed:[\s\S]*case "second failure" \(ignored\) failed:/)
    })
  })

  it('cases with identical snippets and different expectations produce independent outcomes', async () => {
    await withoutRunner(async () => {
      await expect(testIgnorer(stringsIgnored, {
        ignored: [
          { name: 'right expectation', code: 'foo("x")', ignores: ['"x"'] },
          { name: 'wrong expectation', code: 'foo("x")', ignores: ['"y"'] },
        ],
      })).rejects.toThrow(
        /case "wrong expectation" \(ignored\) failed:(?![\s\S]*case "right expectation" \(ignored\) failed:)/,
      )
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
    if (captured === undefined) throw new Error('recorder never consulted')
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
    const saved = savedRunner()
    setGlobal('describe', stubDescribe)
    setGlobal('it', stubIt)
    try {
      await testIgnorer(stringsIgnored, {
        kept: [{ name: 'sibling stays green', code: 'const a = 1' }],
        ignored: [{ name: 'sabotage goes red', code: 'foo(1)', ignores: ['"nope"'] }],
      })
    } finally {
      setGlobal('describe', saved.describe)
      setGlobal('it', saved.it)
    }
    expect(suite).toBe('strings-ignored')
    expect(titles).toEqual(['sibling stays green', 'sabotage goes red'])
    if (greenFn === undefined || redFn === undefined) throw new Error('registration missing')
    await expect(greenFn()).resolves.toBeUndefined()
    await expect(redFn()).rejects.toThrow(/was not ignored/)
  })
})
