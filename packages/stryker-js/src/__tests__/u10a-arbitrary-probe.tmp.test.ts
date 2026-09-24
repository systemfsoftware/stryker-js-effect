import { describe, it } from '@effect/vitest'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { AnsiCode, AnsiColor } from '../reporting/ansi.schema.js'
import { StreamSchemaVersion, VerdictEnvelopeSchemaVersion } from '../reporting/stream-version.schema.js'
import { ActionableStatus, RunId, VerdictEnvelope, VerdictMutant, VerdictThresholds } from '../reporting/verdict-envelope.schema.js'

describe('u10a arbitrary derivation probe (throwaway)', () => {
  it('derives arbitraries for every exported U10a schema', () => {
    const candidates = [
      ['StreamSchemaVersion', StreamSchemaVersion],
      ['VerdictEnvelopeSchemaVersion', VerdictEnvelopeSchemaVersion],
      ['AnsiColor', AnsiColor],
      ['AnsiCode', AnsiCode],
      ['ActionableStatus', ActionableStatus],
      ['RunId', RunId],
      ['VerdictMutant', VerdictMutant],
      ['VerdictThresholds', VerdictThresholds],
      ['VerdictEnvelope', VerdictEnvelope],
    ]
    const failures: string[] = []
    for (const [name, schema] of candidates) {
      try {
        Arbitrary.schema(schema as never).arbitrary
      } catch {
        failures.push(name)
      }
    }
    console.log('derivation failures:', failures)
    return failures.length === 0
  })
})
