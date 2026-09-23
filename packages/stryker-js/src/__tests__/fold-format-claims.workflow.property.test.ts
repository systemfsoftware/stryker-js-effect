import { describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ClaimsDeduplicated,
  ClaimsFolded,
  foldFormatClaims,
  FoldFormatClaimsCommand,
  FormatClaimsFolded,
} from '../run/fold-format-claims.workflow.js'

const FoldFormatClaimsTypeId = Symbol.for('@systemfsoftware/stryker-js/FoldFormatClaimsDecision')

describe('foldFormatClaims', () => {
  it.prop('∀c_Command_∈Decision', [FoldFormatClaimsCommand], ([command]) => {
    const result = foldFormatClaims(command)
    if (!Result.isSuccess(result)) {
      return false
    }
    return Object.getOwnPropertySymbols(result.success).includes(FoldFormatClaimsTypeId)
  })

  it.prop('∀c_Claimed_⊆Resolved', [FoldFormatClaimsCommand], ([command]) => {
    const result = foldFormatClaims(command)
    if (!Result.isSuccess(result)) {
      return false
    }
    const claimed = [...command.coreClaims, ...command.frameworkClaims].flatMap((claim) => claim.extensions)
    if (!S.is(FormatClaimsFolded)(result.success)) {
      return false
    }
    const folded = result.success
    const seen = ((): ReadonlyArray<string> => {
      const rows = folded.rows.map((row) => row.extension)
      const shadowings = folded.shadowings.map((shadowing) => shadowing.extension)
      return [...rows, ...shadowings]
    })()
    const claimedSet = new Set(claimed)
    return (
      claimed.every((extension) => seen.includes(extension)) &&
      new Set(seen).size === claimedSet.size &&
      (S.is(ClaimsFolded)(folded) || S.is(ClaimsDeduplicated)(folded))
    )
  })

  it.prop('∀c_FirstClaim_≡Winner', [FoldFormatClaimsCommand], ([command]) => {
    const result = foldFormatClaims(command)
    if (!Result.isSuccess(result)) {
      return false
    }
    if (!S.is(FormatClaimsFolded)(result.success)) {
      return false
    }
    const folded = result.success
    const claims = [...command.coreClaims, ...command.frameworkClaims]
    const firstOwnerOf = (extension: string): string | undefined =>
      claims.find((claim) => claim.extensions.includes(extension))?.ownerModule
    const contested = command.frameworkClaims.flatMap((claim) =>
      claim.extensions.filter((extension) => {
        const first = claims.find((candidate) => candidate.extensions.includes(extension))
        return first !== undefined && first.ownerModule !== claim.ownerModule
      })
    )
    const losersMatchFirstClaim = contested.every((extension) =>
      folded.shadowings.some(
        (entry) => entry.extension === extension && entry.winner === firstOwnerOf(extension),
      )
    )
    const winnersMatchFirstClaim = [...folded.rows].every(
      (row) => row.ownerModule === firstOwnerOf(row.extension),
    )
    return losersMatchFirstClaim && winnersMatchFirstClaim
  })
})
