/**
 * Checker — declarations for the TypeScript checker.
 *
 * Houses the wire types and error variants shared by the capability and its
 * workflow. Decoded at the checker boundary; no I/O.
 */
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const TypescriptCheckerOptionsSchema = S.Struct({
  typescriptChecker: S.optional(S.Struct({})),
})

// ── command ────────────────────────────────────────────────────────────────

export class CheckMutantsCommand extends S.TaggedClass<CheckMutantsCommand>()(
  'CheckMutantsCommand',
  {
    mutants: S.Array(Checker.CheckerMutantWire),
  },
) {}
