import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'

import { IdGenerator } from '../Worker.service.js'

const makeIdGenerator = Effect.fn(SpanTaxonomy.Spans.workerIdGeneratorMake.name)(function*() {
  const ref = yield* Ref.make(0)
  return {
    next: Ref.getAndUpdate(ref, (n) => n + 1),
  }
})

export const layer = Layer.effect(IdGenerator)(makeIdGenerator())
