import * as S from 'effect/Schema'

export const BakeReasonCode = S.Literals([
  'E2E_BAKE_ARGV',
  'E2E_BAKE_BOOT_OVER_BUDGET',
  'E2E_BAKE_INSTALL_STALLED',
  'E2E_BAKE_OVER_BUDGET',
  'E2E_BAKE_TARBALL_MISSING',
  'E2E_BAKE_FAILED',
  'E2E_SETUP_FAILED',
])
export type BakeReasonCode = typeof BakeReasonCode.Type

export const BakeReason = S.Struct({ code: BakeReasonCode, detail: S.String, next: S.String })
export type BakeReason = typeof BakeReason.Type

export const NothingBaked = S.TaggedStruct('NothingBaked', {})
export type NothingBaked = typeof NothingBaked.Type

export const Baked = S.TaggedStruct('Baked', { bootSeconds: S.Finite, installSeconds: S.Finite })
export type Baked = typeof Baked.Type

export const BakePhases = S.Union([NothingBaked, Baked])
export type BakePhases = typeof BakePhases.Type

export const BakeDone = S.TaggedStruct('BakeDone', {
  packsKey: S.String,
  fixtures: S.Int,
  baked: S.Int,
  seconds: S.Finite,
  phases: BakePhases,
  locks: S.Record(S.String, S.String),
  entries: S.Array(S.String),
}).check(
  S.makeFilter((done) =>
    done.baked <= done.fixtures ? undefined : 'a bake cannot have baked more fixtures than it has'
  ),
)
export type BakeDone = typeof BakeDone.Type

export const BakeFailed = S.TaggedStruct('BakeFailed', {
  reasons: S.NonEmptyArray(BakeReason),
  seconds: S.Finite,
})
export type BakeFailed = typeof BakeFailed.Type

export const BakeRecord = S.Union([BakeDone, BakeFailed])
export type BakeRecord = typeof BakeRecord.Type

const acceptsBakedAtMostFixtures = (draft: { readonly fixtures: number; readonly baked: number }): boolean =>
  S.is(BakeDone)({
    _tag: 'BakeDone',
    packsKey: 'packs-key',
    fixtures: draft.fixtures,
    baked: draft.baked,
    seconds: 1,
    phases: { _tag: 'NothingBaked' },
    locks: {},
    entries: [],
  })

export const BakeReport = S.Struct({
  packsKey: S.String,
  baked: S.Int,
  entries: S.Array(S.String),
  summary: S.String,
  annotations: S.Array(S.String),
})
export type BakeReport = typeof BakeReport.Type

export const BakeReportJson = S.fromJsonString(BakeReport)

if (import.meta.vitest !== void 0) {
  // the fork's `it` and `effect/Array` must stay out of the built module graph, so they load only under this guard
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const BakeDoneDraft = S.Struct({ fixtures: S.Int, baked: S.Int })

  const boundaryDrafts = [
    { fixtures: 0, baked: 0 },
    { fixtures: 0, baked: 1 },
    { fixtures: 1, baked: 0 },
    { fixtures: 1, baked: 1 },
    { fixtures: 1, baked: 2 },
    { fixtures: -1, baked: -1 },
    { fixtures: -1, baked: -2 },
    { fixtures: 2, baked: 3 },
  ]
  const withBoundaries = (drawn: typeof BakeDoneDraft.Type): ReadonlyArray<typeof BakeDoneDraft.Type> =>
    Arr.appendAll([...boundaryDrafts], [drawn])

  it.prop(
    '∀d_BakedAtMostFixtures_≡TheBakeDoneStructRelation',
    { of: [BakeDoneDraft], subject: acceptsBakedAtMostFixtures },
    (subject, [drawn]) =>
      Arr.every(withBoundaries(drawn), (draft) => subject(draft) === (draft.baked <= draft.fixtures)),
  )
}
