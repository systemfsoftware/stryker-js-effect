export interface Cell<A> {
  current: A
}

export const update = <A>(cell: Cell<A>, f: (a: A) => A): A => (cell.current = f(cell.current))
