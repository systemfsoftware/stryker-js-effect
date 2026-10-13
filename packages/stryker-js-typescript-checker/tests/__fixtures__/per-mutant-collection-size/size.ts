export const nonEmpty = (xs: string[]): boolean => xs.length > 0
export const sized = (box: { length: number }): boolean => box.length > 0
export const loose = (xs: any): boolean => xs.length > 0
export const atLeastOne = (xs: string[]): boolean => xs.length > 1
export const lonely = (xs: string[]): boolean => xs.length > 0
export const atMost = (xs: string[]): boolean => xs.length > 0
export const textOrList = (xs: string[] | string): boolean => xs.length > 0
export const listOrBox = (xs: string[] | { length: number }): boolean => xs.length > 0
export const getterSized = (box: { get items(): string[] }): boolean => box.items.length > 0
export const mirroredAtMost = (s: string): boolean => 0 < s.length
export const pairSized = (pair: [string, ...string[]]): boolean => pair.length > 0
export class Box { items: string[] = []; get any(): boolean { return this.items.length > 0 } }
export const leftGreater = (xs: string[]): boolean => xs.length >= 0
export const rightLess = (s: string): boolean => 0 <= s.length
export const rightAtLeast = (s: string): boolean => 0 < s.length
export const duplicateSize = (xs: string[]): boolean => xs.length > 0
export const duplicatedBacking = (xs: string[]): boolean => xs.length > 0
