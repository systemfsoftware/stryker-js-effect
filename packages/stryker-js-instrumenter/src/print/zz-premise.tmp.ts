import type * as Oxc from '@oxc-project/types'
import type { Node } from '@systemfsoftware/stryker-ignorer-interface'

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

type PrintedNode = Simplify<Built<Oxc.Node>>

declare const raw: Oxc.Node
const rawAssignable: PrintedNode = raw

declare const node: Node
const nodeAssignable: PrintedNode = node

export { rawAssignable, nodeAssignable }
