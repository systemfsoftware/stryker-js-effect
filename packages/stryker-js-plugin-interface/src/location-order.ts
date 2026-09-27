import * as Order from 'effect/Order'

export interface Ends<A> {
  readonly start: A
  readonly end: A
}

export const inOrder = <A>(order: Order.Order<A>) => (ends: Ends<A>): Ends<A> => ({
  start: Order.min(order)(ends.start, ends.end),
  end: Order.max(order)(ends.start, ends.end),
})

export const notReversed = <A>(order: Order.Order<A>) => (ends: Ends<A>): boolean =>
  Order.isLessThanOrEqualTo(order)(ends.start, ends.end)
