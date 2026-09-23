import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as S from 'effect/Schema'
import type { StandardSchemaV1 } from 'effect/StandardSchema'

import {
  DryRunCompleted,
  MutantTested,
  ReporterEventSchema,
  ReporterEventUnion,
} from '@systemfsoftware/stryker-js-plugin-interface'
import type { ReporterEvent } from '@systemfsoftware/stryker-js-plugin-interface'
import { RunMutantTested } from '../run-event.schema.js'

type Validation = StandardSchemaV1.Result<ReporterEvent> | 'async'

const validateSync = <T = unknown>(input: T): Validation => {
  const out = ReporterEventSchema['~standard'].validate(input)
  if (out instanceof Promise) return 'async'
  return out
}

const encodeFixture = (
  schema: typeof ReporterEventUnion | typeof DryRunCompleted | typeof MutantTested,
  value: ReporterEvent,
) => S.encodeEffect(schema)(value)

const reencoded = (run: Effect.Effect<ReporterEvent>) =>
  Effect.map(Effect.flatMap(run, (value) => encodeFixture(ReporterEventUnion, value)), (encoded) =>
    JSON.stringify(encoded))


const withTag = <T = unknown, Tag = unknown>(input: T, tag: Tag): T => {
  if (typeof input !== 'object' || input === null) return input
  return { ...input, _tag: tag }
}

const withoutTag = <T = unknown>(input: T): T => {
  if (typeof input !== 'object' || input === null) return input
  const copy = { ...input }
  Reflect.deleteProperty(copy, '_tag')
  return copy
}

const corruptByDraw = <T = unknown>(encoded: T): T => {
  const fingerprint = JSON.stringify(encoded).length % 3
  if (fingerprint === 1) return withTag(encoded, 'not-a-kind')
  if (fingerprint === 2) return withoutTag(encoded)
  return encoded
}

const injectCoverage = <T = unknown>(input: T): T => {
  if (typeof input !== 'object' || input === null) return input
  return { ...input, mutantCoverage: { perTest: { t1: { m1: 1 } }, static: { m1: 2 } } }
}
const hasResultShape = (result: Validation): boolean => {
  if (result === 'async') return false
  if ('value' in result) return !('issues' in result)
  return result.issues.length > 0
}

const stripsMutantCoverage = <T = unknown>(encoded: T): boolean => {
  const clean = validateSync(encoded)
  if (clean === 'async' || !('value' in clean)) return false
  const stripped = validateSync(injectCoverage(encoded))
  if (stripped === 'async' || !('value' in stripped)) return false
  return !('mutantCoverage' in stripped.value)
}

const rejectsUnknownTag = (result: Validation): boolean => {
  if (result === 'async') return false
  if ('value' in result) return false
  if (result.issues.length === 0) return false
  const fingerprint = JSON.stringify(result.issues.map((issue) => ({ message: issue.message, path: issue.path })))
  return fingerprint.includes('_tag') || fingerprint.includes('Expected')
}


describe('ReporterEvent', () => {
  it.effect.prop(
    '∀e_Event_≡Decode',
    [ReporterEventUnion],
    ([event]) =>
      Effect.gen(function*() {
        const encoded = yield* encodeFixture(ReporterEventUnion, event)
        const drawn = corruptByDraw(encoded)
        const valid = validateSync(drawn)
        const decoded = S.decodeExit(ReporterEventUnion)(drawn)
        if (!('value' in valid) || 'issues' in valid) {
          return Exit.isFailure(decoded) && !('value' in valid) && valid.issues.length > 0
        }
        if (Exit.isFailure(decoded)) return false
        return (yield* reencoded(Effect.succeed(valid.value))) === (yield* reencoded(Effect.succeed(decoded.value)))
      }),
  )
  it.effect.prop(
    '∀e_Validate_≡Shape',
    [ReporterEventUnion],
    ([event]) =>
      Effect.map(
        encodeFixture(ReporterEventUnion, event),
        (encoded) => hasResultShape(validateSync(corruptByDraw(encoded))),
      ),
  )




  it.effect.prop(
    '∀d_DryRun_≠Coverage',
    [DryRunCompleted],
    ([event]) =>
      Effect.map(encodeFixture(DryRunCompleted, event), (encoded) => stripsMutantCoverage(encoded)),
  )


  it.effect.prop(
    '∀e_UnknownTag_≡Reject',
    [ReporterEventUnion],
    ([event]) =>
      Effect.map(encodeFixture(ReporterEventUnion, event), (encoded) =>
        rejectsUnknownTag(validateSync(withTag(encoded, 'not-a-kind')))),
  )


  it.effect.prop(
    '∀m_Tested_≡MachineAlphabet',
    [MutantTested],
    ([event]) =>
      Effect.gen(function*() {
        const encoded = yield* encodeFixture(MutantTested, event)
        const members = Object.keys(encoded).filter((key) => key !== '_tag').sort()
        const pinned = ['completed', 'file', 'id', 'location', 'mutator', 'replacement', 'status', 'total']
        if (members.join(',') !== pinned.join(',')) return false
        return Exit.isSuccess(S.decodeExit(RunMutantTested)({ ...encoded, _tag: 'mutant' }))
      }),
  )
})
