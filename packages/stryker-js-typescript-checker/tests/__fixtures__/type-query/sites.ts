export const s: 'a' | 'b' = 'a'
declare function tuple(t: readonly [string]): void
tuple(['x'])
declare function id<T>(x: T): T
export const r: string = id('x')
export const n: number = 1
export const flag: boolean = true
declare function literals<const L extends ReadonlyArray<string>>(values: L): L
export const codes = literals(['a', 'b'])
export const asserted = "a" as 'a' | 'b'
export const lazy = id(() => 'x')
export const letters: ReadonlyArray<'a' | 'b'> = ['a']
export const pair: readonly [string, boolean] = ['k', true] as const
/* oxlint-disable effecttsgo/async-function, typescript/no-non-null-assertion, typescript/no-unnecessary-condition, typescript/strict-boolean-expressions, unicorn/no-useless-spread */
declare const maybe: string | undefined
export const nonNull: string = maybe!
export const paren: number = (21)
export const element: ReadonlyArray<number> = [22]
export const member: { readonly v: number } = { v: 23 }
const w = 24
export const shorthand: { readonly w: number } = { w }
declare const c: boolean
export const branch: number = c ? 25 : 26
export const constAsserted: readonly [27] = [27] as const
export const satisfied = { k: 29 } satisfies { readonly k: number }
export let assigned: number = 0
assigned = 30
export function returned(): number { return 31 }
export const arrowBody = (): number => 32
export class Holder { readonly p: number = 33 }
export function defaulted(q: number = 34): number { return q }
declare function takes(x: number): void
takes(35)
export const arraySpread: ReadonlyArray<number | string> = [...[36]]
export const objectSpread: { readonly a: number } = { a: 1, ...{ b: 37 } }
declare function rest(...xs: ReadonlyArray<number | string>): void
rest(...[38])
declare const str: string
export const coalesceDrop: string = str ?? 'r'
export const coalesceKeep: string = maybe ?? 'm'
declare const box: { readonly x: 1 }
export const orDrop: object = box || {}
export const orKeep: string = str || 'o'
declare const off: false
export const andDrop: false = off && true
declare const on: boolean
export const andKeep: boolean = on && true
declare const anyv: any
export const anyOr: string = anyv || 'a'
export const anyNullish: string = anyv ?? 'b'
export const anyAnd: string = anyv && 'c'
// @effect-diagnostics-next-line asyncFunction:off
export async function asyncReturn(): Promise<number> { return 41 }
export function* generatorReturn(): Generator<number, number> { yield 0; return 42 }
export function isText(x: unknown): x is string { return typeof x === 'string' }
export const sibling: { readonly a: number } = { ...{}, a: 44 }
declare class Box { constructor(n: number) }
export const boxed = new Box(45)
