import type * as Oxc from '@oxc-project/types'
import { walk } from 'oxc-walker'
import type { Node, Program } from '@systemfsoftware/stryker-ignorer-interface'

type Simplify<T> = { [K in keyof T]: T[K] } & {}

type Built<T> = T extends null | undefined ? T
  : T extends readonly unknown[] ? (number extends T['length'] ? Array<Built<T[number]>> : T)
  : T extends Oxc.Span ?
      & {
        [K in keyof T as K extends keyof Oxc.Span ? never : K]: Child<T[K]>
      }
      & Partial<Pick<T, keyof Oxc.Span>>
  : T

type Child<T> = T extends null | undefined ? T
  : T extends readonly unknown[] ? (number extends T['length'] ? Array<Child<T[number]>> : T)
  : T extends Oxc.Span ? Built<T> | T
  : T

export const a = (root: Oxc.Program | Oxc.Node): void => walk(root, {})

export const b = (root: Simplify<Built<Oxc.Program>>): void => walk(root, {})

export const c = (root: Simplify<Built<Oxc.Program>>): Oxc.Program => root

export const d = (root: Oxc.Program): Simplify<Built<Oxc.Program>> => root

export const e = (root: Program | Node): void => walk(root, {})
