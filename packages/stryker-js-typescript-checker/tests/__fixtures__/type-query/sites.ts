export const s: 'a' | 'b' = 'a'
declare function tuple(t: readonly [string]): void
tuple(['x'])
declare function id<T>(x: T): T
export const r: string = id('x')
export const n: number = 1
export const flag: boolean = true
