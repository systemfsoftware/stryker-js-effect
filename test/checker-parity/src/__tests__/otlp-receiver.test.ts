import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'

import {
  countsOfSpans,
  countsSchemaVersionsOf,
  decodeOtlpExport,
  emptySpanCounts,
  projectCheckSpans,
  spanRecordsOf,
} from '../otlp-receiver.js'

const MUTANT_ID = '0123456789abcdef'

const span = (name: string, attributes: ReadonlyArray<readonly [string, unknown]>): unknown => ({
  name,
  attributes: attributes.map(([key, value]) => ({ key, value })),
})

const checkSpan = (
  serviceName: string,
  mutantIds: string,
  attributes: ReadonlyArray<readonly [string, unknown]>,
): unknown => ({
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
      scopeSpans: [
        {
          scope: { name: 'checker' },
          spans: [
            span('typescript-checker.compiler.check', [
              ['stryker.mutants.ids', { stringValue: mutantIds }],
              ...attributes,
            ]),
          ],
        },
      ],
    },
  ],
})

const decode = (body: unknown) => Result.getOrThrow(decodeOtlpExport(JSON.stringify(body)))

const BRANCH_COUNTS: ReadonlyArray<readonly [string, unknown]> = [
  ['typescript.snapshot_updates.count', { intValue: '3' }],
  ['typescript.resplices.count', { intValue: '2' }],
  ['typescript.tce_builds.count', { intValue: '1' }],
  ['typescript.tce.ms', { doubleValue: 12.5 }],
  ['typescript.importer_shortcut.count', { intValue: '4' }],
  ['typescript.importer_shortcut.fallback.clause-a.count', { intValue: '2' }],
  ['typescript.counts.schema_version', { intValue: '1' }],
]

describe('decodeOtlpExport', () => {
  it('fails on a body that is not an OTLP export request', function*({ expect }) {
    yield* expect(decodeOtlpExport('{"not":"otlp"}')).toSatisfy(
      Result.isFailure,
      'a body with no resourceSpans is refused',
    )
  })
})

describe('spanRecordsOf', () => {
  it('flattens resource, scope and span and reads the service name and scalar attributes', function*({ expect }) {
    const body = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'checker-parity-branch' } }] },
          scopeSpans: [
            { scope: { name: 'checker' }, spans: [span('typescript-checker.compiler.check', BRANCH_COUNTS)] },
            {
              scope: { name: 'checker' },
              spans: [span('typescript-checker.check', [['stryker.mutants.count', { intValue: '1' }]])],
            },
          ],
        },
      ],
    }
    const records = spanRecordsOf(decode(body))
    yield* expect(records.map((record) => ({
      name: record.name,
      serviceName: record.serviceName,
      tceMs: record.attributes.get('typescript.tce.ms'),
      snapshotUpdates: record.attributes.get('typescript.snapshot_updates.count'),
    }))).toStrictEqual([
      {
        name: 'typescript-checker.compiler.check',
        serviceName: 'checker-parity-branch',
        tceMs: 12.5,
        snapshotUpdates: 3,
      },
      {
        name: 'typescript-checker.check',
        serviceName: 'checker-parity-branch',
        tceMs: undefined,
        snapshotUpdates: undefined,
      },
    ])
  })
})

describe('countsOfSpans', () => {
  it('sums the KTD6 attributes and reads an intValue string as a number', function*({ expect }) {
    const spans = projectCheckSpans(
      spanRecordsOf(decode(checkSpan('checker-parity-branch', MUTANT_ID, BRANCH_COUNTS))),
      'checker-parity-branch',
      new Set([MUTANT_ID]),
    )
    yield* expect(countsOfSpans(spans)).toStrictEqual({
      snapshotUpdates: 3,
      resplices: 2,
      tceBuilds: 1,
      tceMs: 12.5,
      importerShortcuts: 4,
      fallbacks: { 'clause-a': 2 },
      checkSpans: 1,
    })
  })

  it('accepts an intValue that arrived as a JSON number', function*({ expect }) {
    const spans = projectCheckSpans(
      spanRecordsOf(
        decode(checkSpan('checker-parity-branch', MUTANT_ID, [['typescript.snapshot_updates.count', { intValue: 7 }]])),
      ),
      'checker-parity-branch',
      new Set([MUTANT_ID]),
    )
    yield* expect(countsOfSpans(spans).snapshotUpdates).toBe(7)
  })

  it('counts missing attributes as zero', function*({ expect }) {
    const spans = projectCheckSpans(
      spanRecordsOf(decode(checkSpan('checker-parity-main', MUTANT_ID, []))),
      'checker-parity-main',
      new Set([MUTANT_ID]),
    )
    yield* expect(countsOfSpans(spans)).toStrictEqual({ ...emptySpanCounts, checkSpans: 1 })
  })

  it('does not confuse a zero intValue string with a missing attribute', function*({ expect }) {
    const spans = projectCheckSpans(
      spanRecordsOf(
        decode(
          checkSpan('checker-parity-branch', MUTANT_ID, [['typescript.snapshot_updates.count', { intValue: '0' }]]),
        ),
      ),
      'checker-parity-branch',
      new Set([MUTANT_ID]),
    )
    yield* expect(countsOfSpans(spans).snapshotUpdates).toBe(0)
  })

  it("never attributes another project's check span", function*({ expect }) {
    const spans = projectCheckSpans(
      spanRecordsOf(decode(checkSpan('checker-parity-branch', 'ffffffffffffffff', BRANCH_COUNTS))),
      'checker-parity-branch',
      new Set([MUTANT_ID]),
    )
    yield* expect(spans).toStrictEqual([])
  })
})

describe('countsSchemaVersionsOf', () => {
  it('reads the version a branch span declared and reports it verbatim', function*({ expect }) {
    const spans = spanRecordsOf(decode(checkSpan('checker-parity-branch', MUTANT_ID, BRANCH_COUNTS)))
    yield* expect(countsSchemaVersionsOf(spans)).toStrictEqual([1])
  })

  it('surfaces an unsupported version so the caller can refuse', function*({ expect }) {
    const spans = spanRecordsOf(
      decode(checkSpan('checker-parity-branch', MUTANT_ID, [['typescript.counts.schema_version', { intValue: '2' }]])),
    )
    yield* expect(countsSchemaVersionsOf(spans)).toStrictEqual([2])
  })

  it('declares nothing when the attribute is absent', function*({ expect }) {
    const spans = spanRecordsOf(decode(checkSpan('checker-parity-main', MUTANT_ID, [])))
    yield* expect(countsSchemaVersionsOf(spans)).toStrictEqual([])
  })
})
