/**
 * Checker — declarations for the TypeScript checker.
 *
 * Houses the wire types and error variants shared by the capability and its
 * workflow. Decoded at the checker boundary; no I/O.
 */
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export const ImporterCheck = S.Literals(['location-rule', 'always'])
export type ImporterCheck = typeof ImporterCheck.Type

export const TypescriptCheckerOptionsSchema = S.Struct({
  typescriptChecker: S.optional(S.Struct({ importerCheck: S.optional(ImporterCheck) })),
})
export type TypescriptCheckerOptions = typeof TypescriptCheckerOptionsSchema.Type

export const importerCheckOf = (options: TypescriptCheckerOptions): ImporterCheck =>
  Option.getOrElse(
    Option.flatMapNullishOr(Option.fromUndefinedOr(options.typescriptChecker), (checker) => checker.importerCheck),
    (): ImporterCheck => 'location-rule',
  )

export const readsEditSites = (importerCheck: ImporterCheck): boolean => importerCheck === 'location-rule'

// ── command ────────────────────────────────────────────────────────────────

export class CheckMutantsCommand extends S.TaggedClass<CheckMutantsCommand>()(
  'CheckMutantsCommand',
  {
    mutants: S.Array(Checker.CheckerMutantWire),
  },
) {}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  it.prop(
    '∀c_ImporterCheckOf_≡TheConfiguredValueElseTheLocationRule',
    { of: [ImporterCheck], subject: importerCheckOf },
    (subject, [configured]) =>
      subject({ typescriptChecker: { importerCheck: configured } }) === configured &&
      Arr.every([{}, { typescriptChecker: {} }], (unset) => subject(unset) === 'location-rule'),
  )

  it.prop(
    '∀c_ReadsEditSites_≡OnlyUnderTheLocationRule',
    { of: [ImporterCheck], subject: readsEditSites },
    (subject, [importerCheck]) => subject(importerCheck) === (importerCheckOf({}) === importerCheck),
  )
}
