/**
 * Checker — declarations for the TypeScript checker.
 *
 * Houses the wire types and error variants shared by the capability and its
 * workflow. Decoded at the checker boundary; no I/O.
 */
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const ImporterCheck = S.Literals(['location-rule', 'always'])
export type ImporterCheck = typeof ImporterCheck.Type

export const TypescriptCheckerOptionsSchema = S.Struct({
  typescriptChecker: S.optional(S.Struct({ importerCheck: S.optional(ImporterCheck) })),
})

// ── command ────────────────────────────────────────────────────────────────

export class CheckMutantsCommand extends S.TaggedClass<CheckMutantsCommand>()(
  'CheckMutantsCommand',
  {
    mutants: S.Array(Checker.CheckerMutantWire),
  },
) {}
