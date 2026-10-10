import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Equal from 'effect/Equal'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { JsonObject } from 'effect/Schema'

import { DependencyRecord } from '../catalog-resolution.schema.js'
import {
  type LockfilePins,
  LockfilePinsResolved,
  pinnedManifest,
  PnpmListing,
  PnpmListingJson,
  type PnpmNode,
  type PnpmProject,
} from '../lockfile-pins.schema.js'
import { lockfilePins, LockfilePinsCommand } from '../lockfile-pins.workflow.js'

const REGISTRY = 'https://registry.npmjs.org/'
const PROJECT = 'root-project'
const NAMES = ['pkg-a', 'pkg-b', '@scope/pkg-c'] as const
const VERSIONS = ['1.0.0', '2.0.0', '1.0.0-rc.1'] as const
const VERSION_LITERALS = [...VERSIONS, 'link:../dep'] as const
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const Entry = S.Struct({
  key: S.Literals(NAMES),
  from: S.Literals(NAMES),
  version: S.Literals(VERSION_LITERALS),
  resolved: S.Literals(['registry', 'file', 'jsr', 'absent']),
})
type Entry = typeof Entry.Type

const entriesArb = Arbitrary.array(Arbitrary.schema(Entry), { maxLength: 8 })
const workspaceArb = Arbitrary.map(
  Arbitrary.array(Arbitrary.schema(S.Literals(NAMES)), { maxLength: 2 }),
  (names): ReadonlyArray<string> => names,
)
const projectNameArb = Arbitrary.schema(S.Literals(NAMES))

const RESOLVED_PREFIX: Readonly<Record<string, string>> = {
  registry: REGISTRY,
  file: 'file:../.sfs-deps/',
  jsr: 'https://npm.jsr.io/',
}

const nodeOf = (entry: Entry): PnpmNode => ({
  from: entry.from,
  version: entry.version,
  resolved: entry.resolved === 'absent' ? undefined : `${RESOLVED_PREFIX[entry.resolved]}${entry.key}`,
})

const chainOf = (entries: ReadonlyArray<Entry>): PnpmNode | undefined =>
  entries.reduce<{ readonly node: PnpmNode | undefined; readonly depth: number }>(
    ({ node, depth }, entry) => ({
      node: node === undefined
        ? nodeOf(entry)
        : { ...nodeOf(entry), dependencies: { [`k${depth + 1}`]: node } },
      depth: depth + 1,
    }),
    { node: undefined, depth: 0 },
  ).node

const projectOf = (entries: ReadonlyArray<Entry>, name: string): PnpmProject => {
  const node = chainOf(entries)
  return { name, version: '0.0.0', path: '/root', devDependencies: node === undefined ? {} : { k0: node } }
}

const duplicatedProjectOf = (entries: ReadonlyArray<Entry>, name: string): PnpmProject => {
  const node = chainOf(entries)
  return {
    name,
    version: '0.0.0',
    path: '/root',
    devDependencies: node === undefined ? {} : { k0: node, kDup: node },
  }
}

const expectedPins = (
  entries: ReadonlyArray<Entry>,
  workspaceNames: ReadonlyArray<string>,
  projectName: string,
): Readonly<Record<string, string>> => {
  const byName = new Map<string, ReadonlyArray<Entry>>()
  for (const entry of entries) byName.set(entry.from, [...(byName.get(entry.from) ?? []), entry])
  const pins: Record<string, string> = {}
  for (const [name, list] of byName) {
    const versions = [...new Set(list.map((entry) => entry.version))]
    const pinnable = list.every((entry) => entry.resolved === 'registry' && EXACT.test(entry.version))
    if (pinnable && versions.length === 1 && name !== projectName && !workspaceNames.includes(name)) {
      pins[name] = versions[0]
    }
  }
  return pins
}

const expectedVariant = (
  entries: ReadonlyArray<Entry>,
  workspaceNames: ReadonlyArray<string>,
  projectName: string,
  pins: Readonly<Record<string, string>>,
): string => {
  const withheld = [...new Set(entries.map((entry) => entry.from))].some((name) =>
    name !== projectName && !workspaceNames.includes(name) && !Object.hasOwn(pins, name)
  )
  return withheld ? 'LockfilePinsPartial' : 'LockfilePinsResolved'
}

const LINK_KEY = '@systemfsoftware/stryker-js-vm-runner'

const listingCaseArb = Arbitrary.map(Arbitrary.schema(PnpmListing), (listing) => {
  const head: PnpmProject = listing.length === 0
    ? { name: 'app', version: '0.0.0', path: '/app' }
    : listing[0]
  const deduped: PnpmNode = {
    from: `effect-${head.path}`,
    version: `1.0.${head.name}`,
    resolved: `${REGISTRY}effect/-/effect.tgz`,
    deduped: true,
    dedupedDependenciesCount: head.name.length,
  }
  const link: PnpmNode = { from: `link-${head.name}`, version: `link:../${head.path}`, path: `link-${head.version}` }
  const marked: PnpmListing = [
    { ...head, dependencies: { ...(head.dependencies ?? {}), effect: deduped, [LINK_KEY]: link } },
    ...listing.slice(1),
  ]
  return {
    text: JSON.stringify(
      marked,
      (_key, value: unknown) => typeof value === 'number' && !Number.isFinite(value) ? undefined : value,
    ),
    expected: marked[0].dependencies ?? {},
  }
})

const PINS_ANCHOR = '4.5.6'

const PinExtra = S.Struct({ name: S.Literals(['pkg-b', 'pkg-c']), version: S.Literals(VERSIONS) })

const pinsArb = Arbitrary.map(
  Arbitrary.array(Arbitrary.schema(PinExtra), { maxLength: 2 }),
  (extras): LockfilePins =>
    LockfilePinsResolved.make({
      pins: Object.fromEntries([
        ['pkg-a', PINS_ANCHOR] as const,
        ...extras.map((extra) => [extra.name, extra.version] as const),
      ]),
    }),
)

const ManifestSpecs = S.Struct({
  dependencies: S.NonEmptyString,
  devDependencies: S.NonEmptyString,
  optionalDependencies: S.NonEmptyString,
  overrides: S.Array(S.NonEmptyString),
})

const manifestArb = Arbitrary.map(Arbitrary.schema(ManifestSpecs), (specs): JsonObject => ({
  name: 'app',
  version: '0.0.0',
  dependencies: { 'pkg-a': specs.dependencies, 'pkg-b': '~2.0.0' },
  devDependencies: { 'pkg-a': specs.devDependencies },
  optionalDependencies: { 'pkg-a': specs.optionalDependencies, 'pkg-c': '3.3.3' },
  peerDependencies: { 'pkg-a': '^1.0.0' },
  ...(specs.overrides.length === 0 ? {} : { overrides: { kept: specs.overrides[0] } }),
}))

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const

const specsIn = (manifest: JsonObject, field: string): Readonly<Record<string, string>> | undefined =>
  Option.getOrUndefined(
    Option.flatMap(Option.fromNullishOr(manifest[field]), (value) => S.decodeUnknownOption(DependencyRecord)(value)),
  )

describe('lockfilePins', () => {
  it.prop(
    '∀t_Occurrences_≡NamedPinnedToItsOnlyExactRegistryVersion',
    { of: [entriesArb, workspaceArb, projectNameArb], subject: lockfilePins },
    (subject, [entries, workspaceNames, projectName]) =>
      Result.match(
        subject(LockfilePinsCommand.make({ listing: [projectOf(entries, projectName)], workspaceNames })),
        {
          onFailure: () => false,
          onSuccess: (pins) => {
            const expected = expectedPins(entries, workspaceNames, projectName)
            return Equal.equals(pins.pins, expected) &&
              Equal.equals(pins._tag, expectedVariant(entries, workspaceNames, projectName, expected)) &&
              Object.keys(pins.pins).every((name) => name !== projectName && !workspaceNames.includes(name))
          },
        },
      ),
  )

  it.prop(
    '∀t_ReorderedOrDuplicated_≡SamePins',
    { of: [entriesArb, workspaceArb, projectNameArb], subject: lockfilePins },
    (subject, [entries, workspaceNames, projectName]) => {
      const pinsFor = (listing: PnpmListing) =>
        Result.match(subject(LockfilePinsCommand.make({ listing, workspaceNames })), {
          onFailure: (): undefined => undefined,
          onSuccess: (pins) => pins,
        })
      const base = pinsFor([projectOf(entries, projectName)])
      const reversed = pinsFor([projectOf([...entries].reverse(), projectName)])
      const duplicated = pinsFor([duplicatedProjectOf(entries, projectName)])
      return Option.isSome(Option.fromNullishOr(base)) &&
        Equal.equals(base, reversed) &&
        Equal.equals(base, duplicated)
    },
  )
})

describe('PnpmListingJson', () => {
  it.prop(
    '∀l_ListingsWithDedupedAndLinkNodes_≡NodesSurviveDecoding',
    { of: [listingCaseArb], subject: S.decodeResult(PnpmListingJson) },
    (subject, [{ text, expected }]) =>
      Result.match(subject(text), {
        onFailure: () => false,
        onSuccess: (listing) =>
          Option.match(Option.fromNullishOr(listing[0].dependencies), {
            onNone: () => false,
            onSome: (dependencies) =>
              Option.match(Option.fromNullishOr(dependencies['effect']), {
                onNone: () => false,
                onSome: (effect) =>
                  Equal.equals(
                    { from: effect.from, version: effect.version, deduped: effect.deduped },
                    {
                      from: expected['effect'].from,
                      version: expected['effect'].version,
                      deduped: expected['effect'].deduped,
                    },
                  ) &&
                  Equal.equals(dependencies[LINK_KEY]?.version, expected[LINK_KEY].version),
              }),
          }),
      }),
  )
})

describe('pinnedManifest', () => {
  it.prop(
    '∀m,p,r_Manifest_≡PinnedSpecsWithRoleOverrides',
    { of: [manifestArb, pinsArb, S.Literals(['root', 'member'])], subject: pinnedManifest },
    (subject, [manifest, pins, role]) => {
      const output = subject(manifest, pins, role)
      const fieldsPinned = DEPENDENCY_FIELDS.every((field) => {
        const before = specsIn(manifest, field) ?? {}
        const after = specsIn(output, field) ?? {}
        return Object.keys(before).every((name) =>
          after[name] === (Object.hasOwn(pins.pins, name) ? pins.pins[name] : before[name])
        ) && Object.keys(after).join() === Object.keys(before).join()
      })
      const peersUntouched = Equal.equals(output.peerDependencies, manifest.peerDependencies)
      const metadataUntouched = Equal.equals(output.name, 'app') && Equal.equals(output.version, '0.0.0')
      const idempotent = Equal.equals(subject(output, pins, role), output)
      const overridesHeld = Match.value(role).pipe(
        Match.when('root', () => {
          const overrides = specsIn(output, 'overrides')
          return overrides !== undefined &&
            Equal.equals(overrides, pins.pins) &&
            Object.keys(overrides).join() === Object.keys(overrides).slice().sort().join()
        }),
        Match.when('member', () =>
          Object.hasOwn(output, 'overrides') === Object.hasOwn(manifest, 'overrides') &&
          Equal.equals(output.overrides, manifest.overrides)),
        Match.exhaustive,
      )
      return fieldsPinned && peersUntouched && metadataUntouched && idempotent && overridesHeld
    },
  )
})
