import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { InstrumentResult } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { instrument } from './__fixtures__/instrument.js'

type FidelityRow = {
  readonly name: string
  readonly fileName: string
  readonly source: string
  readonly printed: string
}

// Each row pairs a construct group's source with the exact rendering the
// instrumented file must carry. Two rows pin the tolerant branch: the class
// body index signature in 'classes' and the module reference in
// 'import-equals-qualified' are kinds no printer table classifies.
const ROWS = [
  {
    name: 'literals',
    fileName: '/tmp/printer-corpus/literals.ts',
    source:
      "const a = 'single'\nconst b = \"double\"\nconst c = 42\nconst d = 1_000.5e3\nconst e = 10n\nconst f = /ab+c/gi\nconst g = true\nconst h = null\nconst arr = [1, , 2, ...rest]\nconst obj = { key: 1, 'quoted': 2, [computed]: 3, shorthand, nested: { a: 1 }, ...spread, method() {}, async *gen() {}, get g2() { return 1 }, set g2(v) {}, ['computed-method']() {} }\nconst i = `head ${a} mid ${c + 1} tail`\nconst j = tag`x${a}y`\nconst k = tag<T>`x`\n",
    printed:
      "const a = 'single';\nconst b = \"double\";\nconst c = 42;\nconst d = 1_000.5e3;\nconst e = 10n;\nconst f = /ab+c/gi;\nconst g = true;\nconst h = null;\nconst arr = [1, , 2, ...rest];\nconst obj = { key: 1, 'quoted': 2, [computed]: 3, shorthand, nested: { a: 1 }, ...spread, method() {}, gen() {}, get g2() {\n  return 1;\n}, set g2(v) {}, ['computed-method']() {} };\nconst i = `head ${a} mid ${c + 1} tail`;\nconst j = tag`x${a}y`;\nconst k = tag<T>`x`;\n",
  },
  {
    name: 'precedence',
    fileName: '/tmp/printer-corpus/precedence.ts',
    source:
      "const a = (x + y) * z\nconst b = x - (y - z)\nconst c = x ** y ** z\nconst d = (x ** y) ** z\nconst e = !x && y || z\nconst f = a ?? (b || c)\nconst g = x ? y ? 1 : 2 : 3\nconst h = x = y = z\nconst i = typeof x === 'string' || x instanceof Y\nconst j = f((x, y), a, (b = c))\nconst k = -x + +y - ~z - !w\nconst l = void 0\nconst m = delete o.p\nconst n = x++ + ++y\nconst o = 'k' in obj\n",
    printed:
      "const a = (x + y) * z;\nconst b = x - (y - z);\nconst c = x ** y ** z;\nconst d = (x ** y) ** z;\nconst e = !x && y || z;\nconst f = a ?? (b || c);\nconst g = x ? y ? 1 : 2 : 3;\nconst h = x = y = z;\nconst i = typeof x === 'string' || x instanceof Y;\nconst j = f((x, y), a, (b = c));\nconst k = -x + +y - ~z - !w;\nconst l = void 0;\nconst m = delete o.p;\nconst n = x++ + ++y;\nconst o = 'k' in obj;\n",
  },
  {
    name: 'members-and-calls',
    fileName: '/tmp/printer-corpus/members-and-calls.ts',
    source:
      "const a = o.p\nconst b = o['p']\nconst c = o?.[k]\nconst d = o.m?.()\nconst e = o?.m?.(arg)\nconst f = new Cls<T>(a, ...rest)\nconst g = fn<T>(a)\nconst j = import.meta\nconst k = import('mod', { with: { type: 'json' } })\nconst l = new (foo())()\nconst m = (x, y)\nconst n = (0, obj.m)()\nclass Q extends Base {\n  constructor() {\n    super(a)\n    this.x = super.y\n    const t = new.target\n  }\n  m() {\n    return this.#priv\n  }\n}\n",
    printed:
      "const a = o.p;\nconst b = o['p'];\nconst c = o?.[k];\nconst d = o.m?.();\nconst e = o?.m?.(arg);\nconst f = new Cls<T>(a, ...rest);\nconst g = fn<T>(a);\nconst j = import.meta;\nconst k = import('mod', { with: { type: 'json' } });\nconst l = new (foo())();\nconst m = (x, y);\nconst n = (0, obj.m)();\nclass Q extends Base {\n  constructor() {\n    super(a);\n    this.x = super.y;\n    const t = new.target;\n  }\n  m() {\n    return this.#priv;\n  }\n}\n",
  },
  {
    name: 'functions',
    fileName: '/tmp/printer-corpus/functions.ts',
    source:
      'function decl<T>(a: T, b = 1, ...rest: T[]): T {\n  return a\n}\nasync function* gen() {\n  yield 1\n  yield* other()\n  await p\n}\nconst arrow = (a: number) => a + 1\nconst bare = (a) => a\nconst block = async (a: T): Promise<T> => {\n  return a\n}\nconst destructured = ({ a, b: { c = 1 }, ...rest }, [x, , y]) => ({ a, b: c, rest, x, y })\ndeclare function noBody(a: string): void\nconst anon = function named() {}\nconst expr = function* () {}\nfunction thisParam(this: Window, a?: number, b: string = "x", ...rest: number[]): asserts a is number {}\nfunction guard(): this is Q {}\n',
    printed:
      'function decl<T>(a: T, b = 1, ...rest: T[]): T {\n  return a;\n}\nasync function* gen() {\n  yield 1;\n  yield* other();\n  await p;\n}\nconst arrow = (a: number) => a + 1;\nconst bare = a => a;\nconst block = async (a: T): Promise<T> => {\n  return a;\n};\nconst destructured = ({ a, b: { c = 1 }, ...rest }, [x, , y]) => ({ a, b: c, rest, x, y });\ndeclare function noBody(a: string): void;\nconst anon = function named() {};\nconst expr = function*() {};\nfunction thisParam(this: Window, a?: number, b: string = "x", ...rest: number[]): asserts a is number {}\nfunction guard(): this is Q {}\n',
  },
  {
    name: 'classes',
    fileName: '/tmp/printer-corpus/classes.ts',
    source:
      "@sealed\n@Component({ x: 1 })\nexport class Cls<T> extends Base<T> implements I, J<T> {\n  static #count = 0\n  readonly p: T\n  declare d: number\n  q!: string\n  #priv = 1\n  static {\n    Cls.#count = 1\n  }\n  accessor acc = 2\n  constructor(private readonly dep: Dep, public x = 1) {\n    super()\n  }\n  get g(): number {\n    return 1\n  }\n  set g(v: number) {}\n  async *m<U>(a?: U): Promise<void> {}\n  override method() {}\n  ['computed']() {}\n  [key]: number = 1\n}\nabstract class Abs {\n  abstract m(): void\n  abstract p: string\n  abstract accessor a: number\n}\ndeclare class Decl {\n  m(): void\n  static s(): number\n  get g(): number\n  set s2(v: number)\n  constructor(a: number)\n  [k: string]: unknown\n}\nclass K<in T, out U> {}\n",
    printed:
      "export @sealed @Component({ x: 1 }) class Cls<T> extends Base<T> implements I, J<T> {\n  static #count = 0;\n  readonly p: T;\n  declare d: number;\n  q!: string;\n  #priv = 1;\n  static {\n    Cls.#count = 1;\n  }\n  accessor acc = 2;\n  constructor(private readonly dep: Dep, public x = 1) {\n    super();\n  }\n  get g(): number {\n    return 1;\n  }\n  set g(v: number) {}\n  async *m<U>(a?: U): Promise<void> {}\n  override method() {}\n  ['computed']() {}\n  [key]: number = 1;\n}\nabstract class Abs {\n  m(): void;\n  p: string;\n  accessor a: number;\n}\ndeclare class Decl {\n  m(): void;\n  static s(): number;\n  get g(): number;\n  set s2(v: number);\n  constructor(a: number);\n  /* unknown:TSIndexSignature */\n}\nclass K<in T, out U> {}\n",
  },
  {
    name: 'statements',
    fileName: '/tmp/printer-corpus/statements.ts',
    source:
      "outer: for (let i = 0; i < 10; i++) {\n  if (i) continue outer\n  else break\n}\nfor (;;) {}\nfor (const k in obj) {}\nasync function drain() {\n  for await (const v of xs) {}\n}\nwhile (x) {\n  x--\n}\ndo {\n  x++\n} while (x < 1)\nswitch (x) {\n  case 1:\n    y()\n    break\n  case 'a':\n  case `t`:\n    z()\n  default:\n    w()\n}\ntry {\n  risky()\n} catch {\n  fallback()\n} finally {\n  cleanup()\n}\ntry {} catch (e) {}\nthrow new Error('x')\ndebugger\n;\nif (a) b()\nelse if (c) d()\nelse e()\nlab: {}\nif (x) ;\nwhile (y) ;\nlab2: ;\n",
    printed:
      "outer: for (let i = 0; i < 10; i++) {\n  if (i) continue outer; else break;\n}\nfor (; ; ) {}\nfor (const k in obj) {}\nasync function drain() {\n  for await (const v of xs) {}\n}\nwhile (x) {\n  x--;\n}\ndo {\n  x++;\n} while (x < 1);\nswitch (x) {\n  case 1:\n    y();\n    break;\n  case 'a':\n  case `t`:\n    z();\n  default:\n    w();\n}\ntry {\n  risky();\n} catch {\n  fallback();\n} finally {\n  cleanup();\n}\ntry {} catch (e) {}\nthrow new Error('x');\ndebugger;\nif (a) b(); else if (c) d(); else e();\nlab: {}\nif (x) ;\nwhile (y) ;\nlab2: ;\n",
  },
  {
    name: 'sloppy-js',
    fileName: '/tmp/printer-corpus/sloppy-js.js',
    source:
      'with (obj) {\n  a = 1\n}\n/** @type {number} */\nconst a = 1\n/** @param {string} s @returns {boolean} */\nfunction f(s) {\n  return true\n}\n"use strict"\n',
    printed:
      'with (obj) {\n  a = 1;\n}\n/** @type {number} */\nconst a = 1;\n/** @param {string} s @returns {boolean} */\nfunction f(s) {\n  return true;\n}\n"use strict";\n',
  },
  {
    name: 'bindings',
    fileName: '/tmp/printer-corpus/bindings.ts',
    source:
      'let a = 1, b\nvar c\nconst { d, e: { f = 1 }, ...g } = obj\nconst [h, , i = 2, ...j] = arr\nlet definite!: number\ndeclare const declared: string\nconst { [k]: computed } = obj\nfor (const [x, y] of pairs) {}\nfor (let q = 0; q < n; q += 1) {}\nconst { m, n: [o] } = obj\n',
    printed:
      'let a = 1, b;\nvar c;\nconst { d, e: { f = 1 }, ...g } = obj;\nconst [h, , i = 2, ...j] = arr;\nlet definite!: number;\ndeclare const declared: string;\nconst { [k]: computed } = obj;\nfor (const [x, y] of pairs) {}\nfor (let q = 0; q < n; q += 1) {}\nconst { m, n: [o] } = obj;\n',
  },
  {
    name: 'imports-and-exports',
    fileName: '/tmp/printer-corpus/imports-and-exports.ts',
    source:
      "import def from './m.js'\nimport * as ns from './n.js'\nimport './side.js'\nimport { a, b as c, type T } from './x.js'\nimport type { Only } from './types.js'\nimport data from './d.json' with { type: 'json' }\nimport {} from './empty.js'\nimport X = require('y')\nexport { a, c as alias }\nexport { type T }\nexport {}\nexport * from './all.js'\nexport * as everything from './ns.js'\nexport type * as t from './t.js'\nexport default function main() {}\nexport default class {}\nexport default 42\nexport const val = 1\nexport let l = 2\nexport function fn() {}\nexport class K {}\nexport type Alias = number\nexport interface Iface {}\nexport declare const dc: number\n",
    printed:
      "import def from './m.js';\nimport * as ns from './n.js';\nimport './side.js';\nimport { a, b as c, type T } from './x.js';\nimport type { Only } from './types.js';\nimport data from './d.json' with { type: \"json\" };\nimport './empty.js';\nimport X = require(\"y\");\nexport { a, c as alias };\nexport { type T };\nexport {  };\nexport * from \"./all.js\";\nexport * as everything from \"./ns.js\";\nexport type * as t from \"./t.js\";\nexport default function main() {}\nexport default class {}\nexport default 42;\nexport const val = 1;\nexport let l = 2;\nexport function fn() {}\nexport class K {}\nexport type Alias = number;\nexport interface Iface {}\nexport declare const dc: number;\n",
  },
  {
    name: 'import-equals-qualified',
    fileName: '/tmp/printer-corpus/import-equals-qualified.ts',
    source: "import T = A.B.C\nimport q = require('m')\n",
    printed: 'import T = /* unknown:TSQualifiedName */;\nimport q = require("m");\n',
  },
  {
    name: 'export-assignments',
    fileName: '/tmp/printer-corpus/export-assignments.ts',
    source: 'export as namespace Lib\ndeclare const exportedValue: number\nexport = exportedValue\n',
    printed: 'export as namespace Lib;\ndeclare const exportedValue: number;\nexport = exportedValue;\n',
  },
  {
    name: 'modules-and-enums',
    fileName: '/tmp/printer-corpus/modules-and-enums.ts',
    source:
      "namespace A {\n  export const x = 1\n}\ndeclare module 'mod' {\n  export const y: number\n}\ndeclare global {\n  interface Window {\n    z: number\n  }\n}\nmodule B {}\nconst enum CE {\n  A = 1,\n  B\n}\ndeclare enum DE {\n  X\n}\nenum E {\n  A,\n  B = 2,\n  'c-d' = 3\n}\nexport enum EE {}\n",
    printed:
      "namespace A {\n  export const x = 1;\n}\ndeclare module 'mod' {\n  export const y: number;\n}\ndeclare global  {\n  interface Window {\n    z: number;\n  }\n}\nmodule B {\n}\nconst enum CE {\n  A = 1,\n  B,\n}\ndeclare enum DE {\n  X,\n}\nenum E {\n  A,\n  B = 2,\n  'c-d' = 3,\n}\nexport enum EE {\n}\n",
  },
  {
    name: 'interfaces',
    fileName: '/tmp/printer-corpus/interfaces.ts',
    source:
      "interface Empty {}\ninterface Full<T> extends A<T>, B {\n  readonly p?: T\n  [k: string]: unknown\n  (a: T): void\n  new (a: T): Full<T>\n  m<U>(a: U): U\n  get g(): number\n  set s(v: number)\n  'quoted': string\n  [computed]: number\n  method?(): void\n}\n",
    printed:
      "interface Empty {}\ninterface Full<T> extends A<T>, B {\n  readonly p?: T;\n  [k: string]: unknown;\n  (a: T): void;\n  new (a: T): Full<T>;\n  m<U>(a: U): U;\n  get g(): number;\n  set s(v: number);\n  'quoted': string;\n  [computed]: number;\n  method?(): void;\n}\n",
  },
  {
    name: 'types',
    fileName: '/tmp/printer-corpus/types.ts',
    source:
      "type A = any | string | boolean | number | bigint | symbol | void | undefined | null | never | unknown | object | intrinsic\ntype B = { a: number; b?: string; readonly c: boolean }\ntype C = T[]\ntype D = A['key']\ntype E = keyof A & (readonly string[])\ntype E2 = A & B | C\ntype F = T extends U ? infer X extends V ? X : never : false\ntype G = { readonly [K in keyof T as `get${K}`]-?: T[K] }\ntype G2 = { +readonly [K in T]+?: U }\ntype G3 = { -readonly [K in T]-?: U }\ntype H = `a${B}c`\ntype I = typeof globalThis\ntype J = import('mod').Q<number>\ntype J2 = typeof import('mod')\ntype K = (a: number) => void\ntype L = abstract new (a: number) => Q\ntype M = (a: unknown) => a is string\ntype N = (a: unknown) => asserts a is string\ntype O = 'lit' | 42 | -1 | true\ntype P = (number)\ntype R = this\ntype S = [number, last?: Date, ...string[]]\ntype U = readonly string[]\ntype U2 = readonly [1, 2]\ntype V = unique symbol\ntype W = A.B.C\ntype Chained = this['x']\n",
    printed:
      "type A = any | string | boolean | number | bigint | symbol | void | undefined | null | never | unknown | object | intrinsic;\ntype B = { a: number; b?: string; readonly c: boolean };\ntype C = T[];\ntype D = A['key'];\ntype E = keyof A & (readonly string[]);\ntype E2 = A & B | C;\ntype F = T extends U ? infer X extends V ? X : never : false;\ntype G = { readonly [K in keyof T as `get${K}`]-?: T[K] };\ntype G2 = { +readonly [K in T]+?: U };\ntype G3 = { -readonly [K in T]-?: U };\ntype H = `a${B}c`;\ntype I = typeof globalThis;\ntype J = import(\"mod\").Q<number>;\ntype J2 = typeof import(\"mod\");\ntype K = (a: number) => void;\ntype L = abstract new (a: number) => Q;\ntype M = (a: unknown) => a is string;\ntype N = (a: unknown) => asserts a is string;\ntype O = 'lit' | 42 | -1 | true;\ntype P = (number);\ntype R = this;\ntype S = [number, last?: Date, ...string[]];\ntype U = readonly string[];\ntype U2 = readonly [1, 2];\ntype V = unique symbol;\ntype W = A.B.C;\ntype Chained = this['x'];\n",
  },
  {
    name: 'ts-expressions',
    fileName: '/tmp/printer-corpus/ts-expressions.ts',
    source:
      'const a = x as T\nconst b = x satisfies T\nconst c = <T>x\nconst d = x!\nconst e = fn<T>\nconst f = x as unknown as T\nconst g = x!.y\nconst h = (x as T)()\n',
    printed:
      'const a = x as T;\nconst b = x satisfies T;\nconst c = <T>x;\nconst d = x!;\nconst e = fn<T>;\nconst f = x as unknown as T;\nconst g = x!.y;\nconst h = (x as T)();\n',
  },
  {
    name: 'jsx',
    fileName: '/tmp/printer-corpus/jsx.tsx',
    source:
      'const el = <div className="a" data-x={1} hidden ns:attr="v" {...rest}>\n  text {expr}\n  <b>inner</b>\n  <Ns.Member.Sub a={x} />\n  <></>\n</div>\nconst frag = <>{a}<b />{}</>\nconst edge = <svg:rect ns:a="1" b={y} d={<D />} />\nconst spread = <d>{...xs}</d>\n',
    printed:
      'const el = <div className="a" data-x={1} hidden ns:attr="v" {...rest}>\n  text {expr}\n  <b>inner</b>\n  <Ns.Member.Sub a={x} />\n  <></>\n</div>;\nconst frag = <>{a}<b />{}</>;\nconst edge = <svg:rect ns:a="1" b={y} d={<D />} />;\nconst spread = <d>{...xs}</d>;\n',
  },
] as const satisfies readonly FidelityRow[]

const Feature = makeFeature({ it, layer })

Feature('Rendering instrumented source')
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'The <name> construct group renders to the intended source form',
      ROWS,
      (row) =>
        Gherkin.Do.pipe(
          Given('a source file for a supported construct group')('source', () => Effect.succeed(row.source)),
          When('the file is instrumented without mutation')(
            'result',
            ({ source }: { source: string }) =>
              instrument([{ name: row.fileName, content: source, mutate: false }], {
                ignorers: [],
                excludedMutations: [],
              }),
          ),
          Then('the rendered source is exactly the intended form')((
            { result }: { result: InstrumentResult },
          ) =>
            Effect.sync(() => {
              expect(result.files[0]?.content).toBe(row.printed)
            })
          ),
        ),
    )
  })
