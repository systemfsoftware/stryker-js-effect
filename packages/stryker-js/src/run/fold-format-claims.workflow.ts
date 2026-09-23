import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const FormatClaimRow = S.Struct({
  ownerModule: S.String,
  formatId: S.String,
  language: S.String,
  extensions: S.Array(S.String),
})

export class FoldFormatClaimsCommand extends S.TaggedClass<FoldFormatClaimsCommand>()(
  'FoldFormatClaimsCommand',
  {
    coreClaims: S.Array(FormatClaimRow),
    frameworkClaims: S.Array(FormatClaimRow),
  },
) {}

const FormatClaimShadowingRow = S.Struct({
  extension: S.String,
  winner: S.String,
  loser: S.String,
})

const ResolvedFormatRow = S.Struct({
  extension: S.String,
  formatId: S.String,
  ownerModule: S.String,
  language: S.String,
})

const FoldedTypeId = Symbol.for('@systemfsoftware/stryker-js/FoldFormatClaimsDecision')
type FoldedTypeId = typeof FoldedTypeId

export class ClaimsFolded extends S.TaggedClass<ClaimsFolded>()('ClaimsFolded', {
  rows: S.Array(ResolvedFormatRow),
  shadowings: S.Array(FormatClaimShadowingRow),
}) {
  readonly [FoldedTypeId] = FoldedTypeId
}

export class ClaimsDeduplicated extends S.TaggedClass<ClaimsDeduplicated>()('ClaimsDeduplicated', {
  rows: S.Array(ResolvedFormatRow),
  shadowings: S.Array(FormatClaimShadowingRow),
}) {
  readonly [FoldedTypeId] = FoldedTypeId
}

export const FormatClaimsFolded = S.Union([ClaimsFolded, ClaimsDeduplicated])
export type FormatClaimsFolded = typeof FormatClaimsFolded.Type

interface ClaimFoldState {
  readonly claimed: HashMap.HashMap<string, { formatId: string; ownerModule: string; language: string }>
  readonly rows: readonly { extension: string; formatId: string; ownerModule: string; language: string }[]
  readonly shadowings: readonly { extension: string; winner: string; loser: string }[]
}

const emptyClaimFoldState = (): ClaimFoldState => ({
  claimed: HashMap.empty<string, { formatId: string; ownerModule: string; language: string }>(),
  rows: [],
  shadowings: [],
})

const foldExtension = (
  state: ClaimFoldState,
  claim: typeof FormatClaimRow.Type,
  extension: string,
): ClaimFoldState =>
  Option.match(HashMap.get(state.claimed, extension), {
    onNone: () => ({
      claimed: HashMap.set(state.claimed, extension, {
        formatId: claim.formatId,
        ownerModule: claim.ownerModule,
        language: claim.language,
      }),
      rows: [
        ...state.rows,
        {
          extension,
          formatId: claim.formatId,
          ownerModule: claim.ownerModule,
          language: claim.language,
        },
      ],
      shadowings: state.shadowings,
    }),
    onSome: (winner) => ({
      ...state,
      shadowings: [
        ...state.shadowings,
        { extension, winner: winner.ownerModule, loser: claim.ownerModule },
      ],
    }),
  })

const foldClaim = (state: ClaimFoldState, claim: typeof FormatClaimRow.Type): ClaimFoldState =>
  claim.extensions.reduce((inner, extension) => foldExtension(inner, claim, extension), state)

interface FoldedRows {
  readonly rows: ReadonlyArray<{ extension: string; formatId: string; ownerModule: string; language: string }>
  readonly shadowings: ReadonlyArray<{ extension: string; winner: string; loser: string }>
}

const foldedOf = (command: FoldFormatClaimsCommand): FoldedRows => {
  const folded = [...command.coreClaims, ...command.frameworkClaims].reduce(foldClaim, emptyClaimFoldState())
  return { rows: [...folded.rows], shadowings: [...folded.shadowings] }
}

export const foldFormatClaims = Workflow.total(
  FoldFormatClaimsCommand,
  (command) =>
    Match.value(Option.fromUndefinedOr(command.frameworkClaims[0])).pipe(
      Match.discriminator('_tag')(
        'Some',
        () => Result.succeed(ClaimsFolded.make(foldedOf(command))),
      ),
      Match.discriminator('_tag')(
        'None',
        () => Result.succeed(ClaimsDeduplicated.make(foldedOf(command))),
      ),
      Match.exhaustive,
    ),
)
