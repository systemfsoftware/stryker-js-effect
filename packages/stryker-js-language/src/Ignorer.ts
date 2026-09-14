import type { Node } from '@systemfsoftware/stryker-ignorer-interface'
import * as Context from 'effect/Context'
import type * as Option from 'effect/Option'

export interface IgnorerService {
  readonly shouldIgnore: (node: Node, ancestors: readonly Node[]) => Option.Option<string>
}

export class Ignorer
  extends Context.Service<Ignorer, IgnorerService>()('~@systemfsoftware/stryker-js-language/Ignorer')
{}
