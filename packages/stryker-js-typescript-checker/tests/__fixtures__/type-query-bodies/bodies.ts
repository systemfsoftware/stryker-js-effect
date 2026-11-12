// @effect-diagnostics asyncFunction:off unnecessaryArrowBlock:off
/* oxlint-disable @systemfsoftware/cell-architecture/ban-unknown, effecttsgo/async-function */
declare function consume(): void

export function plainNumber(): number { return 1 }
export function plainUnion(): number | undefined { return 1 }
export function plainVoid(): void { consume() }
export function plainUnknown(): unknown { return 1 }
export function plainAny(): any { return 1 }
export function plainNever(): never { throw new Error('never') }
export function plainUndefined(): undefined { return undefined }
export function plainNull(): null { return null }

export async function asyncNumber(): Promise<number> { return 1 }
export async function asyncVoid(): Promise<void> { return }
export async function asyncUnion(): Promise<number | undefined> { return 1 }
export async function asyncUnknown(): Promise<unknown> { return 1 }

export class Accessors {
  get text(): string { return 'a' }
  get maybe(): string | undefined { return undefined }
  get anything(): any { return 1 }
  get nothing(): void { return }
  get undef(): undefined { return undefined }
  set value(next: number) { consume() }
}

export function overloaded(a: string): string
export function overloaded(a: number): number
export function overloaded(a: string | number): string | number { return a }

export function overloadedAny(a: string): string
export function overloadedAny(a: number): number
export function overloadedAny(a: any): any { return a }

export abstract class Abstractish {
  abstract abstractMethod(): number
}

declare class Declaredish {
  declaredMethod(): number
}

export class Methods {
  method(): number { return 1 }
  thisMethod(): this { return this }
}

export const arrowNumber = (): number => { return 1 }
export const arrowExpression = (): number => 1
export const functionNumber = function (): number { return 1 }
export const objectMethod = { method(): number { return 1 } }
export const contextual: () => number = () => { return 1 }

export function genericT<T>(): T { return undefined as unknown as T }
export function genericMaybe<T>(): T | undefined { return undefined }
export function assertThing(x: boolean): asserts x { if (!x) throw new Error('assert') }
export function promiseVoid(): Promise<void> { return Promise.resolve() }

export function* generate(): Generator<number> { yield 1 }

export function nested(flag: boolean): number {
  if (flag) { return 1 }
  return 2
}

export class Constructed {
  constructor() { consume() }
}
