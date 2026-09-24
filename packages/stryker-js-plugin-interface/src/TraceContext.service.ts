import * as Context from 'effect/Context'
import * as Option from 'effect/Option'

import type { TraceContextParts } from './TraceContext.schema.js'

export const TraceContextReference: Context.Reference<Option.Option<TraceContextParts>> = Context.Reference(
  '@systemfsoftware/stryker-js-plugin-interface/TraceContextReference',
  { defaultValue: () => Option.none() },
)
