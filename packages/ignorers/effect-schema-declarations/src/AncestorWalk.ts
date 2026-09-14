import type { NodePath } from '@systemfsoftware/stryker-ignorer-interface'

export function* ancestorsOf(path: NodePath): Generator<unknown> {
  for (let current = path.parentPath; current; current = current.parentPath) {
    yield current.node
  }
}
