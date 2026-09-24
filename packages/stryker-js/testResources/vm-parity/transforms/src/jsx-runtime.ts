export interface VNode {
  readonly tag: string
  readonly props: Record<string, unknown> | null
  readonly children: readonly VNode[]
}

export const text = (value: string): VNode => ({ tag: '#text', props: { value }, children: [] })

const isVNode = (value: unknown): value is VNode =>
  typeof value === 'object' && value !== null && 'tag' in value && 'children' in value

export const h = (tag: string, props: Record<string, unknown> | null, ...children: unknown[]): VNode => ({
  tag,
  props,
  children: children.flat().map((child) => (isVNode(child) ? child : text(String(child)))),
})

export const Fragment = 'fragment'
