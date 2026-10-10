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
