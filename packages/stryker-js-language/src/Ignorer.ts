import type { NodePath } from '@systemfsoftware/stryker-ignorer-interface'
import * as Context from 'effect/Context'
import type * as Option from 'effect/Option'

export type { NodePath }

export interface IgnorerService {
  readonly shouldIgnore: (path: NodePath) => Option.Option<string>
}

export class Ignorer
  extends Context.Service<Ignorer, IgnorerService>()('~@systemfsoftware/stryker-js-language/Ignorer')
{}
