export const nonEmpty = (xs: string[]): boolean => xs.length > 0
export const sized = (box: { length: number }): boolean => box.length > 0
export const loose = (xs: any): boolean => xs.length > 0
export const atLeastOne = (xs: string[]): boolean => xs.length > 1
export const lonely = (xs: string[]): boolean => xs.length > 0
export const atMost = (xs: string[]): boolean => xs.length > 0
export const textOrList = (xs: string[] | string): boolean => xs.length > 0
export const listOrBox = (xs: string[] | { length: number }): boolean => xs.length > 0
export const getterSized = (box: { get items(): string[] }): boolean => box.items.length > 0
