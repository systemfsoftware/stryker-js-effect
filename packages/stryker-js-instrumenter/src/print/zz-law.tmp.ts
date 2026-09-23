import { printProgram } from './index.js'
if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const { Schema } = await import('effect')
  const oxc = await import('oxc-parser')

  const TEMPLATE_TYPE_FRAGMENTS = Schema.Array(
    Schema.Literals([
      'export type T1 = `v${string}`;',
      'export type T2 = `x${T1 | string}y${number}`;',
      'export type T3 = `a${T2}${T1}b`;',
      'export interface W1 { readonly f: `p${T3}` }',
      'export type T4 = ``;',
      'export type T5 = `${T1}`;',
      'export type T6 = `mix ${T4 | `inner ${T1}`}`;',
      'export const once = (x: string) => x;',
    ]),
  )

  const TS_FRAGMENTS = Schema.Array(
    Schema.Literals([
      '// lead\nconst commented = 1;',
      '/* block */\nconst afterBlock = 2; // trailing\n',
      'const t = `a${b}c${`n${x}`}d`;',
      'const e = ``;',
      'const raw = String.raw`\\u{1F600}`;',
      'a\n++b',
      'x = y\n(z || w).v',
      'const f = () => {\nreturn\n1\n};',
      'const re = /^\\d{3}$/gi;',
      'x?.y?.[k]?.(v) ?? z;',
      'const { a = 1, ...r } = o; [p, ...q] = arr;',
      'class A extends B { static f?: string = "v"; #p = 1; accessor y = 2 }',
      'label: for (const x of xs) { continue label }',
      'switch (e) { case 1: break; default: h() }',
      'try { f() } catch ({ message }) { g(message) } finally { h() }',
      'import type { A } from "m";',
      'export * as ns from "n";',
      'import x = require("y");',
      'export default function () {}',
      'async function* g<T>(a: T, ...rest: T[]): AsyncGenerator<T> { yield* rest }',
      'obj?.a?.[k]?.(v)!;',
      'new (Cls())(arg);',
      'do { f() } while (c)',
      'debugger;',
      'type P = a extends b ? c : d;',
      'type Q = infer R extends S ? R : never;',
      'type M = { readonly [K in keyof T as `get${K & string}`]?: T[K] };',
      'enum E { A = 1, B }',
      'declare module "m" { export const x: number }',
      'v = v satisfies T as U;',
      'let x!: string;',
      '@dec\nclass D {}',
      'abstract class C { declare protected readonly override x?: number; constructor(private readonly y: number) { super() } }',
    ]),
  )

  const TSX_FRAGMENTS = Schema.Array(
    Schema.Literals([
      'const el = <div className="x" {...props}>text{n}</div>;',
      'const f = <>frag</>;',
      'const m = <A.B.C a={1} b="s" c />;',
      'const t = <input disabled />;',
    ]),
  )

  const printed = (source: string, lang: 'ts' | 'tsx'): string => {
    const parsed = oxc.parseSync('law.ts', source, { lang, range: true })
    return printProgram(parsed.program, { comments: parsed.comments, hashbang: null })
  }

  it.prop('∀src_TemplateTypePrint_≡Reparse', [TEMPLATE_TYPE_FRAGMENTS], ([fragments]) => {
    const once = printed(fragments.join('\n'), 'ts')
    return printed(once, 'ts') === once
  })

  it.prop('∀src_TsProgramPrint_≡Reparse', [TS_FRAGMENTS], ([fragments]) => {
    const once = printed(fragments.join('\n'), 'ts')
    return printed(once, 'ts') === once
  })

  it.prop('∀src_TsxProgramPrint_≡Reparse', [TSX_FRAGMENTS], ([fragments]) => {
    const once = printed(fragments.join('\n'), 'tsx')
    return printed(once, 'tsx') === once
  })
}
