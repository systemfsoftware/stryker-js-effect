import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'

import type { TypeQueryRefused, TypeQueryRequest, TypeQueryResponse } from './TypeQuery.schema.js'

export interface TypeQueryShape {
  readonly query: (request: TypeQueryRequest) => Effect.Effect<TypeQueryResponse, TypeQueryRefused>
}

export class TypeQuery extends Context.Service<TypeQuery, TypeQueryShape>()(
  '@systemfsoftware/stryker-js-plugin-interface/TypeQuery.service/TypeQuery',
) {}
