import { describe, it } from '@effect/vitest'
import * as Exit from 'effect/Exit'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { StandardSchemaV1 } from 'effect/StandardSchema'

import {
  DryRunCompleted,
  MutantTested,
  ReporterEventSchema,
  ReporterEventUnion,
} from '@systemfsoftware/stryker-js-plugin-interface'
import type { ReporterEvent } from '@systemfsoftware/stryker-js-plugin-interface'
import { RunMutantTested } from '../RunEvent.schema.js'

type Validation = StandardSchemaV1.Result<ReporterEvent> | 'async'

const validateSync = (input: unknown): Validation => {
  const out = ReporterEventSchema['~standard'].validate(input)
  if (out instanceof Promise) return 'async'
  return out
}

const encodeFixture = <S extends S.ConstraintEncoder<unknown>>(schema: S, value: S['Type']): S['Encoded'] =>
  Result.getOrThrow(S.encodeResult(schema)(value))

const reencoded = (value: ReporterEvent): string => JSON.stringify(encodeFixture(ReporterEventUnion, value))

const withTag = (input: unknown, tag: unknown): unknown => {
  if (typeof input !== 'object' || input === null) return input
  return { ...input, _tag: tag }
}

const withoutTag = (input: unknown): unknown => {
  if (typeof input !== 'object' || input === null) return input
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key !== '_tag') rest[key] = value
  }
  return rest
}

const corruptByDraw = (encoded: unknown): unknown => {
  const fingerprint = JSON.stringify(encoded).length % 3
  if (fingerprint === 1) return withTag(encoded, 'not-a-kind')
  if (fingerprint === 2) return withoutTag(encoded)
  return encoded
}

const injectCoverage = (input: unknown): unknown => {
  if (typeof input !== 'object' || input === null) return input
  return { ...input, mutantCoverage: { perTest: { t1: { m1: 1 } }, static: { m1: 2 } } }
}

const agreesWithDecode = (input: unknown): boolean => {
  const standard = validateSync(input)
  if (standard === 'async') return false
  const decoded = S.decodeUnknownExit(ReporterEventUnion)(input)
  if ('value' in standard) {
    if (Exit.isFailure(decoded)) return false
    if ('issues' in standard) return false
    return reencoded(standard.value) === reencoded(decoded.value)
  }
  return Exit.isFailure(decoded) && standard.issues.length > 0
}

const hasResultShape = (result: Validation): boolean => {
  if (result === 'async') return false
  if ('value' in result) return !('issues' in result)
  return result.issues.length > 0
}

const stripsMutantCoverage = (encoded: unknown): boolean => {
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
  it.prop(
    '∀e_Event_≡Decode',
    [ReporterEventUnion],
    ([event]) => agreesWithDecode(corruptByDraw(encodeFixture(ReporterEventUnion, event))),
  )

  it.prop(
    '∀e_Validate_≡Shape',
    [ReporterEventUnion],
    ([event]) => hasResultShape(validateSync(corruptByDraw(encodeFixture(ReporterEventUnion, event)))),
  )

  it.prop(
    '∀d_DryRun_≠Coverage',
    [DryRunCompleted],
    ([event]) => stripsMutantCoverage(encodeFixture(DryRunCompleted, event)),
  )

  it.prop(
    '∀e_UnknownTag_≡Reject',
    [ReporterEventUnion],
    ([event]) => rejectsUnknownTag(validateSync(withTag(encodeFixture(ReporterEventUnion, event), 'not-a-kind'))),
  )

  it.prop(
    '∀m_Tested_≡MachineAlphabet',
    [MutantTested],
    ([event]) => {
      const encoded = encodeFixture(MutantTested, event)
      const members = Object.keys(encoded).filter((key) => key !== '_tag').sort()
      const pinned = ['completed', 'file', 'id', 'location', 'mutator', 'replacement', 'status', 'total']
      if (members.join(',') !== pinned.join(',')) return false
      return Exit.isSuccess(S.decodeExit(RunMutantTested)({ ...encoded, _tag: 'mutant' }))
    },
  )
})
