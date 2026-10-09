import { describe } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  PackageExportsResolved,
  resolvePackageExports,
  ResolvePackageExportsCommand,
} from '../resolve-package-exports.workflow.js'

type JsonValue = S.Schema.Type<typeof S.Json>

const resolvedTargetsOf = (exports: JsonValue, subpath: string): ReadonlyArray<string> | undefined => {
  const decision = Result.match(
    resolvePackageExports(ResolvePackageExportsCommand.make({ exports, subpath })),
    {
      onFailure: (refused) => refused,
      onSuccess: (value) => value,
    },
  )
  return S.is(PackageExportsResolved)(decision) ? decision.targets : undefined
}

const resolvedTargetOf = (exports: JsonValue, subpath: string): string | undefined =>
  Option.getOrUndefined(Option.flatMap(Option.fromUndefinedOr(resolvedTargetsOf(exports, subpath)), Arr.head))

const sameOrderOf = (left: ReadonlyArray<string> | undefined, right: ReadonlyArray<string>): boolean => {
  const targets = Option.getOrElse(Option.fromUndefinedOr(left), (): ReadonlyArray<string> => [])
  return (
    Arr.length(targets) === Arr.length(right) &&
    Arr.every(
      targets,
      (target, index) =>
        Option.match(Arr.get(right, index), { onNone: () => false, onSome: (value) => value === target }),
    )
  )
}

const escaped = (text: string): string =>
  Array.from(text, (character) => (character.codePointAt(0) ?? 0).toString(16)).join('.')

const probeKeyOf = (subpath: string): string => `./probe/${escaped(subpath)}`

const ESCAPING_PREFIX = './../'

describe('resolvePackageExports', (it) => {
  it.prop(
    '∀subpath_ExactSubpathKey_≡ResolvesToTarget',
    {
      of: [S.String, S.String],
      subject: (subpath: string, target: string) => {
        const key = probeKeyOf(subpath)
        const relative = `./${escaped(target)}`
        return resolvedTargetOf({ [key]: relative }, key)
      },
    },
    (subject, [subpath, target]) => subject(subpath, target) === `./${escaped(target)}`,
  )

  it.prop(
    '∀subpath_WildcardKey_≡SubstitutesTheCapture',
    {
      of: [S.String, S.String],
      subject: (subpath: string, target: string) => {
        const leaf = escaped(subpath)
        const prefix = `./wildcard/${escaped(target)}`
        return resolvedTargetOf({ [`${prefix}/*`]: './dist/*' }, `${prefix}/${leaf}`)
      },
    },
    (subject, [subpath, target]) => subject(subpath, target) === `./dist/${escaped(subpath)}`,
  )

  it.prop(
    '∀leaf_OverlappingWildcardKeys_≡LongestPrefixByStarWins',
    {
      of: [S.String, S.String],
      subject: (leaf: string, tag: string) =>
        resolvedTargetOf(
          { './x/*': `./generic-${escaped(tag)}.json`, './x/y/*': './specific-*.json' },
          `./x/y/${escaped(leaf)}`,
        ),
    },
    (subject, [leaf, tag]) => subject(leaf, tag) === `./specific-${escaped(leaf)}.json`,
  )

  it.prop(
    '∀leaf_EqualPrefixWildcardKeys_≡LongerKeyWins',
    {
      of: [S.String, S.String],
      subject: (leaf: string, tag: string) =>
        resolvedTargetOf(
          { './x/*': `./generic-${escaped(tag)}.json`, './x/*.json': './specific-*.json' },
          `./x/${escaped(leaf)}.json`,
        ),
    },
    (subject, [leaf, tag]) => subject(leaf, tag) === `./specific-${escaped(leaf)}.json`,
  )

  it.prop(
    '∀value_InactiveConditions_≡UnresolvedUnlessADefault',
    {
      of: [S.String, S.String],
      subject: (subpath: string, value: string) => {
        const key = probeKeyOf(subpath)
        return [
          resolvedTargetOf({ [key]: { browser: value } }, key),
          resolvedTargetOf({ [key]: { browser: value, default: `./default-${escaped(value)}` } }, key),
        ]
      },
    },
    (subject, [subpath, value]) => {
      const [inactiveOnly, withDefault] = subject(subpath, value)
      return inactiveOnly === undefined && withDefault === `./default-${escaped(value)}`
    },
  )

  it.prop(
    '∀subpath_UnkeyedSubpath_≡UnresolvedBesideTheKeyedOne',
    {
      of: [S.String, S.String],
      subject: (subpath: string, target: string) => {
        const key = probeKeyOf(subpath)
        const relative = `./${escaped(target)}`
        const map = { [key]: relative }
        return [resolvedTargetOf(map, `${key}-absent`), resolvedTargetOf(map, key)]
      },
    },
    (subject, [subpath, target]) => {
      const [unkeyed, keyed] = subject(subpath, target)
      return unkeyed === undefined && keyed === `./${escaped(target)}`
    },
  )

  it.prop(
    '∀subpath_LeadingNull_≡UnresolvedBesideTheResolvingEntry',
    {
      of: [S.String, S.String],
      subject: (subpath: string, target: string) => {
        const key = probeKeyOf(subpath)
        const relative = `./${escaped(target)}`
        return [
          resolvedTargetOf({ [key]: [null, relative] }, key),
          resolvedTargetOf({ [key]: [relative] }, key),
        ]
      },
    },
    (subject, [subpath, target]) => {
      const [afterLeadingNull, withoutLeadingNull] = subject(subpath, target)
      return afterLeadingNull === undefined && withoutLeadingNull === `./${escaped(target)}`
    },
  )

  it.prop(
    '∀target_RootArrayLeadingNull_≡UnresolvedBesideTheResolvingEntry',
    {
      of: [S.String],
      subject: (target: string) => {
        const relative = `./${escaped(target)}`
        return [resolvedTargetOf([null, relative], '.'), resolvedTargetOf([relative], '.')]
      },
    },
    (subject, [target]) => {
      const [afterLeadingNull, withoutLeadingNull] = subject(target)
      return afterLeadingNull === undefined && withoutLeadingNull === `./${escaped(target)}`
    },
  )

  it.prop(
    '∀subpath_ConditionObjectNullInArray_≡UnresolvedBesideAConditionTarget',
    {
      of: [S.String, S.String],
      subject: (subpath: string, target: string) => {
        const key = probeKeyOf(subpath)
        const relative = `./${escaped(target)}`
        return [
          resolvedTargetOf({ [key]: [{ default: null }, relative] }, key),
          resolvedTargetOf({ [key]: [{ default: relative }, './fallback.json'] }, key),
        ]
      },
    },
    (subject, [subpath, target]) => {
      const [afterConditionNull, fromCondition] = subject(subpath, target)
      return afterConditionNull === undefined && fromCondition === `./${escaped(target)}`
    },
  )

  it.prop(
    '∀subpath_NestedArrayNull_≡UnresolvedBesideANestedTarget',
    {
      of: [S.String, S.String],
      subject: (subpath: string, target: string) => {
        const key = probeKeyOf(subpath)
        const relative = `./${escaped(target)}`
        return [
          resolvedTargetOf({ [key]: [[null], relative] }, key),
          resolvedTargetOf({ [key]: [[relative], './fallback.json'] }, key),
        ]
      },
    },
    (subject, [subpath, target]) => {
      const [afterNestedNull, fromNested] = subject(subpath, target)
      return afterNestedNull === undefined && fromNested === `./${escaped(target)}`
    },
  )

  it.prop(
    '∀subpath_ActiveConditionNull_≡UnresolvedBesideAnInactiveOne',
    {
      of: [S.String, S.String, S.Literals(['require', 'types', 'node'])],
      subject: (subpath: string, target: string, condition: string) => {
        const key = probeKeyOf(subpath)
        const relative = `./${escaped(target)}`
        return [
          resolvedTargetOf({ [key]: { [condition]: null, default: relative } }, key),
          resolvedTargetOf({ [key]: { browser: null, default: relative } }, key),
        ]
      },
    },
    (subject, [subpath, target, condition]) => {
      const [activeNull, inactiveNull] = subject(subpath, target, condition)
      return activeNull === undefined && inactiveNull === `./${escaped(target)}`
    },
  )

  it.prop(
    '∀subpath_InvalidTargetSegment_≡UnresolvedBesideTheValidOne',
    {
      of: [S.String, S.String, S.String, S.Literals(['.', '..', 'node_modules'])],
      subject: (subpath: string, prefix: string, leaf: string, invalid: string) => {
        const key = probeKeyOf(subpath)
        return [
          resolvedTargetOf({ [key]: `./${escaped(prefix)}/${invalid}/${escaped(leaf)}` }, key),
          resolvedTargetOf({ [key]: `./${escaped(prefix)}/${escaped(leaf)}` }, key),
        ]
      },
    },
    (subject, [subpath, prefix, leaf, invalid]) => {
      const [withInvalidSegment, withoutInvalidSegment] = subject(subpath, prefix, leaf, invalid)
      return withInvalidSegment === undefined && withoutInvalidSegment === `./${escaped(prefix)}/${escaped(leaf)}`
    },
  )

  it.prop(
    '∀subpath_NonRelativeTarget_≡UnresolvedBesideTheRelativeOne',
    {
      of: [S.String, S.String],
      subject: (subpath: string, target: string) => {
        const key = probeKeyOf(subpath)
        const relative = `./${escaped(target)}`
        return [
          resolvedTargetOf({ [key]: relative.slice(1) }, key),
          resolvedTargetOf({ [key]: relative }, key),
        ]
      },
    },
    (subject, [subpath, target]) => {
      const [unresolved, resolved] = subject(subpath, target)
      return unresolved === undefined && resolved === `./${escaped(target)}`
    },
  )

  it.prop(
    '∀entries_ArrayOfResolvableTargets_≡EveryTargetInFallbackOrder',
    {
      of: [Arbitrary.array(Arbitrary.schema(S.String), { minLength: 2, maxLength: 4 })],
      subject: (targets: ReadonlyArray<string>) => {
        const key = './probe/array'
        const entries = Arr.map(targets, (target) => `./${escaped(target)}.json`)
        return resolvedTargetsOf({ [key]: entries }, key)
      },
    },
    (subject, [targets]) =>
      sameOrderOf(
        subject(targets),
        Arr.map(targets, (target) => `./${escaped(target)}.json`),
      ),
  )

  it.prop(
    '∀entries_ArrayWithEscapingTargets_≡OnlyResolvableTargetsInOrderAndNeverEscaping',
    {
      of: [
        Arbitrary.array(Arbitrary.all([Arbitrary.schema(S.String), Arbitrary.schema(S.Boolean)]), { maxLength: 5 }),
      ],
      subject: (entries: ReadonlyArray<readonly [string, boolean]>) => {
        const key = './probe/array'
        const values = Arr.map(entries, ([leaf, escapes]) =>
          Boolean.match(escapes, {
            onTrue: () => `${ESCAPING_PREFIX}${escaped(leaf)}.json`,
            onFalse: () => `./${escaped(leaf)}.json`,
          }))
        return resolvedTargetsOf({ [key]: values }, key)
      },
    },
    (subject, [entries]) => {
      const resolvable = Arr.map(
        Arr.filter(entries, ([, escapes]) => !escapes),
        ([leaf]) => `./${escaped(leaf)}.json`,
      )
      const escaping = Arr.map(
        Arr.filter(entries, ([, escapes]) => escapes),
        ([leaf]) => `${ESCAPING_PREFIX}${escaped(leaf)}.json`,
      )
      const targets = Option.getOrElse(Option.fromUndefinedOr(subject(entries)), (): ReadonlyArray<string> => [])
      return (
        sameOrderOf(targets, resolvable) && Arr.every(escaping, (value) => !Arr.contains(targets, value))
      )
    },
  )
})
