export type * from '@oxc-project/types'

export interface NodePath {
  readonly node: unknown
  readonly ancestors: readonly unknown[]
}

export interface PlainIgnorer {
  readonly name: string
  shouldIgnore(path: NodePath): string | undefined
}
