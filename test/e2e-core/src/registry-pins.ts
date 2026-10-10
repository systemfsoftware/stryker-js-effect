import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Rec from 'effect/Record'

import type { PinnableFields, RegistryPins } from './registry-pins.schema.js'

export interface PinnedManifestInput {
  readonly manifest: PinnableFields
  readonly pins: RegistryPins
  readonly root: boolean
}

type PackageKey = readonly [name: string, version: string]

const LOCKFILE_PACKAGE_KEY = /^ {2}'?((?:@[^/@'\s]+\/)?[^@'\s]+)@([^'(:\s]+)/gm
const SPEC_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const

const isEffectFamily = (name: string): boolean => name === 'effect' || name.startsWith('@effect/')

const packageKeysOf = (pnpmLockfile: string): ReadonlyArray<PackageKey> =>
  Array.from(pnpmLockfile.matchAll(LOCKFILE_PACKAGE_KEY), (match): PackageKey => [match[1], match[2]])

const singleVersionOf = ([name, keys]: readonly [string, ReadonlyArray<PackageKey>]): ReadonlyArray<PackageKey> => {
  const versions = Arr.dedupe(keys.map(([, version]) => version))
  return versions.length === 1 ? [[name, versions[0]]] : []
}

export const registryPinsOf: {
  (catalogNames: ReadonlyArray<string>): (pnpmLockfile: string) => RegistryPins
  (pnpmLockfile: string, catalogNames: ReadonlyArray<string>): RegistryPins
} = dual(
  2,
  (pnpmLockfile: string, catalogNames: ReadonlyArray<string>): RegistryPins =>
    Object.fromEntries(
      Object.entries(Arr.groupBy(
        packageKeysOf(pnpmLockfile).filter(([name]) => isEffectFamily(name) || catalogNames.includes(name)),
        ([name]) => name,
      )).flatMap(singleVersionOf),
    ),
)

const pinSpecs = (specs: Readonly<Record<string, string>>, pins: RegistryPins): Record<string, string> =>
  Rec.map(specs, (spec, name) => Option.getOrElse(Rec.get(pins, name), () => spec))

const pinnedSpecsOf = (input: PinnedManifestInput) => (field: typeof SPEC_FIELDS[number]) =>
  Option.match(Option.fromUndefinedOr(input.manifest[field]), {
    onNone: () => [],
    onSome: (specs) => [[field, pinSpecs(specs, input.pins)] as const],
  })

const overridesOf = (input: PinnedManifestInput): PinnableFields =>
  Boolean.match(input.root && !Rec.isEmptyRecord(input.pins), {
    onFalse: () => ({}),
    onTrue: () => ({ overrides: { ...input.manifest.overrides, ...input.pins } }),
  })

export const pinnedFieldsOf = (input: PinnedManifestInput): PinnableFields => ({
  ...Object.fromEntries(SPEC_FIELDS.flatMap(pinnedSpecsOf(input))),
  ...overridesOf(input),
})
