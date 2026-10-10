import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Workers } from '@systemfsoftware/stryker-js-contracts'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'

const makeIdGenerator = Effect.fn(SpanTaxonomy.Spans.workerIdGeneratorMake.name)(function*() {
  const ref = yield* Ref.make(0)
  return {
    next: Ref.getAndUpdate(ref, (n) => n + 1),
  }
})

export const layer = Layer.effect(Workers.IdGenerator)(makeIdGenerator())
