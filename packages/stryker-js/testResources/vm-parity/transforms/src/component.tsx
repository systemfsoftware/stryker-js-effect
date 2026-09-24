import { Fragment, h } from './jsx-runtime'
import type { VNode } from './jsx-runtime'

export const greeting = (): VNode => <p>hello world</p>

export const list = (items: readonly string[]): VNode => (
  <ul>
    {items.map((item) => <li>{item}</li>)}
  </ul>
)

export const pair = (): VNode => (
  <>
    <span>first</span>
    <span>second</span>
  </>
)
