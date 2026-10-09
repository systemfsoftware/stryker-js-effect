import { describe } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  PackageExportsResolved,
  resolvePackageExports,
  ResolvePackageExportsCommand,
} from '../resolve-package-exports.workflow.js'

type JsonValue = S.Schema.Type<typeof S.Json>

const resolvedTargetOf = (exports: JsonValue, subpath: string): string | undefined => {
  const decision = Result.match(
    resolvePackageExports(ResolvePackageExportsCommand.make({ exports, subpath })),
    {
      onFailure: (refused) => refused,
      onSuccess: (value) => value,
    },
  )
  return S.is(PackageExportsResolved)(decision) ? decision.target : undefined
}

const escaped = (text: string): string =>
  Array.from(text, (character) => (character.codePointAt(0) ?? 0).toString(16)).join('.')

const probeKeyOf = (subpath: string): string => `./probe/${escaped(subpath)}`

describe('resolvePackageExports', (it) => {
  it.prop(
    '∀subpath_ExactSubpathKey_≡ResolvesToTarget',
    {
      of: [S.String, S.String],
      subject: (subpath: string, target: string) => {
        const key = probeKeyOf(subpath)
        return resolvedTargetOf({ [key]: target }, key)
      },
    },
    (subject, [subpath, target]) => subject(subpath, target) === target,
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
        const map = { [key]: target }
        return [resolvedTargetOf(map, `${key}-absent`), resolvedTargetOf(map, key)]
      },
    },
    (subject, [subpath, target]) => {
      const [unkeyed, keyed] = subject(subpath, target)
      return unkeyed === undefined && keyed === target
    },
  )

  it.prop(
    '∀subpath_LeadingNull_≡SkipsToTheResolvingEntry',
    {
      of: [S.String, S.String],
      subject: (subpath: string, target: string) => {
        const key = probeKeyOf(subpath)
        return resolvedTargetOf({ [key]: [null, target] }, key)
      },
    },
    (subject, [subpath, target]) => subject(subpath, target) === target,
  )
})
