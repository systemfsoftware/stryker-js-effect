import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import type { PlatformError } from 'effect/PlatformError'

import { type AtomicWritePorts, replaceFileAtomically } from './replace-file-atomically.js'

export const writeFileAtomic = Effect.fn(SpanTaxonomy.Spans.mutationReportingWriteAtomic.name)(
  (ports: AtomicWritePorts, file: string, content: string): Effect.Effect<void, PlatformError> =>
    replaceFileAtomically(ports, file, content),
)
