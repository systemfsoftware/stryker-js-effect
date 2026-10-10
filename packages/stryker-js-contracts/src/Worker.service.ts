import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'

export interface IdGeneratorShape {
  readonly next: Effect.Effect<number>
}

export class IdGenerator extends Context.Service<IdGenerator, IdGeneratorShape>()(
  '@systemfsoftware/stryker-js/Worker.service/IdGenerator',
) {}
