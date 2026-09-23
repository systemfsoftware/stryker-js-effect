import * as oxc from 'oxc-parser'
import { printProgram } from '../src/print/index.js'
import { printProgram as legacyPrintProgram } from '../src/print/legacy.tmp.js'
import { expect, it } from 'vitest'

const cases: readonly string[] = [
  '',
  '\n',
  'export const add = (a: number, b: number) => a + b\n',
  '#!/usr/bin/env node\n// lead\n/* block */\nexport function f() { return 1 } // tail\n',
  'export type T1 = `v${string}`;\nexport type T2 = `x${T1 | string}y${number}`;\n',
  'const s = `a${b}c${`nested${x}`}d`\n',
  'const re = /^\\d{3}-\\d{4}$/gi\n',
  'a\n++b\nreturn\nc\n',
  'x = a\n(b || c).d\n',
  'export interface W { readonly f: `p${T3}` }\n',
  'const el = <div className="x" {...props}>text{n}</div>;\n',
  'const f = <>frag</>;\n',
  'enum E { A = 1, B }\ndeclare module "m" { export const x: number }\n',
  'type M = { readonly [K in keyof T as `get${K & string}`]?: T[K] }\n',
  'class A { static readonly x?: string = "v"; #p = 1; accessor y = 2 }\n',
  'label: for (const x of xs) { continue label }\n',
  'try { f() } catch ({ message }) { g(message) } finally { h() }\n',
  'import type { A } from "m"; export * as ns from "n"; import x = require("y");\n',
  'export default function () {}\n',
  'async function* g<T>(a: T, ...rest: T[]): AsyncGenerator<T> { yield* rest }\n',
  'const { a = 1, ...rest } = obj; [x = 2] = ys;\n',
  'obj?.a?.[k]?.(v)!;\nnew (Cls())(arg);\n',
  'switch (x) { case 1: break; default: f() }\ndo { f() } while (c)\nwith (o) f()\n',
  'abstract class C { declare protected readonly override x?: number; constructor(private readonly y: number) { super() } }\n',
  'type P = a extends b ? c : d; type Q = infer R extends S ? R : never;\n',
  'let x!: string; export { x as "quoted" };\n',
]

it('prints both ways for diagnosis', () => {
  for (const [index, source] of cases.entries()) {
    const parsed = oxc.parseSync('law.ts', source, { lang: 'ts', range: true })
    const printed = printProgram(parsed.program, { comments: parsed.comments, hashbang: null })
    const legacy = legacyPrintProgram(parsed.program, { comments: parsed.comments, hashbang: null })
    if (printed !== legacy) {
      console.log(`MISMATCH case ${index} source=${JSON.stringify(source)}`)
      console.log(`  new=${JSON.stringify(printed)}`)
      console.log(`legacy=${JSON.stringify(legacy)}`)
    }
    expect(printed, `case ${index} must match legacy: ${JSON.stringify(source)}`).toBe(legacy)
  }
})
