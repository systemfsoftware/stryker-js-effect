import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'

import {
  type CheckerCapabilities,
  TypeQueryNotServed,
  TypeQueryServed,
  type TypeQueryServing,
  type TypeQueryVersion,
} from './TypeQuery.schema.js'

const notServed = (capabilities: CheckerCapabilities, version: TypeQueryVersion): TypeQueryServing =>
  TypeQueryNotServed.make({
    version,
    declared: capabilities.typeQuery,
    nextAction: `Keep every mutant: this checker declares type-query versions [${
      capabilities.typeQuery.join(', ')
    }], not ${version}. Use a checker that declares version ${version}, or send a version it declares.`,
  })

export const typeQueryServingOf: {
  (version: TypeQueryVersion): (capabilities: CheckerCapabilities) => TypeQueryServing
  (capabilities: CheckerCapabilities, version: TypeQueryVersion): TypeQueryServing
} = dual(
  2,
  (capabilities: CheckerCapabilities, version: TypeQueryVersion): TypeQueryServing =>
    Boolean.match(Arr.contains(capabilities.typeQuery, version), {
      onTrue: () => TypeQueryServed.make({ version }),
      onFalse: () => notServed(capabilities, version),
    }),
)
