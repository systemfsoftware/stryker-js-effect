import { describe, it } from '@effect/vitest'
import * as Exit from 'effect/Exit'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { StandardSchemaV1 } from 'effect/StandardSchema'

import { Reporter } from '../mod.js'

type ReporterEvent = Reporter.ReporterEvent

type Validation = StandardSchemaV1.Result<ReporterEvent> | 'async'

const validateSync = <T = unknown>(input: T): Validation => {
  const out = Reporter.ReporterEventSchema['~standard'].validate(input)
  if (out instanceof Promise) return 'async'
  return out
}

const encodeUnionEvent = (value: ReporterEvent) =>
  Result.getOrThrow(S.encodeResult(Reporter.ReporterEventUnion)(value))

const encodeDryRun = (value: Reporter.DryRunCompleted) =>
  Result.getOrThrow(S.encodeResult(Reporter.DryRunCompleted)(value))

const encodeMutantTested = (value: Reporter.MutantTested) =>
  Result.getOrThrow(S.encodeResult(Reporter.MutantTested)(value))

const reencoded = (value: ReporterEvent): string => JSON.stringify(encodeUnionEvent(value))

const withTag = <T = unknown>(input: T, tag: string): T => {
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

const agreesWithDecode = <T = unknown>(input: T): boolean => {
  const standard = validateSync(input)
  if (standard === 'async') return false
  const decoded = S.decodeUnknownExit(Reporter.ReporterEventUnion)(input)
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
  it.prop(
    '∀e_Event_≡Decode',
    [Reporter.ReporterEventUnion],
    ([event]) => agreesWithDecode(corruptByDraw(encodeUnionEvent(event))),
  )

  it.prop(
    '∀e_Validate_≡Shape',
    [Reporter.ReporterEventUnion],
    ([event]) => hasResultShape(validateSync(corruptByDraw(encodeUnionEvent(event)))),
  )

  it.prop('∀d_DryRun_≠Coverage', [Reporter.DryRunCompleted], ([event]) => stripsMutantCoverage(encodeDryRun(event)))

  it.prop(
    '∀e_UnknownTag_≡Reject',
    [Reporter.ReporterEventUnion],
    ([event]) => rejectsUnknownTag(validateSync(withTag(encodeUnionEvent(event), 'not-a-kind'))),
  )

  it.prop('∀m_Tested_≡MachineAlphabet', [Reporter.MutantTested], ([event]) => {
    const encoded = encodeMutantTested(event)
    const members = Object.keys(encoded).filter((key) => key !== '_tag').sort()
    const pinned = ['completed', 'file', 'id', 'location', 'mutator', 'replacement', 'status', 'total']
    return members.join(',') === pinned.join(',')
  })
})
