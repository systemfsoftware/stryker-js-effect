import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Equal from 'effect/Equal'
import * as Rec from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  parseFixtureManifest,
  parseWorkspaceCatalogs,
  resolveCatalogSpecs,
  type WorkspaceCatalogs,
} from '../catalog-resolution.js'
import {
  DependencySpecs,
  MalformedFixtureManifest,
  UnresolvedCatalogSpec,
  WorkspaceCatalogsYaml,
} from '../catalog-resolution.schema.js'

const MANIFEST = 'fixture/package.json'
const DEFAULT_SENTINEL = 'default-catalog-sentinel'
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

const NAME_HEAD = ['a', 'z', 'A', 'Z', '0', '9'] as const
const NAME_TAIL = ['a', 'z', 'A', 'Z', '0', '9', '-', '_', '.', '@', '/'] as const
const RANGE_HEAD = ['0', '1', '9', '^', '~', '<', '>', '=', '*'] as const
const RANGE_TAIL = ['0', '1', '9', '^', '~', '<', '>', '=', '*', '.', '+', '-'] as const

const nameArb = Arbitrary.map(
  Arbitrary.schema(S.Tuple([S.Literals(NAME_HEAD), S.Array(S.Literals(NAME_TAIL))])),
  ([head, tail]) => `${head}${tail.join('')}`,
)
const rangeArb = Arbitrary.map(
  Arbitrary.schema(S.Tuple([S.Literals(RANGE_HEAD), S.Array(S.Literals(RANGE_TAIL))])),
  ([head, tail]) => `${head}${tail.join('')}`,
)
const catalogNameArb = Arbitrary.map(nameArb, (name) => (name === 'default' ? `${name}0` : name))

const emptyCatalogs: WorkspaceCatalogs = { default: {}, named: {} }

describe('resolveCatalogSpecs', () => {
  it.prop(
    '∀s_DefaultCatalogSpec_≡CatalogVersion',
    { of: [nameArb, rangeArb], subject: resolveCatalogSpecs },
    (subject, [packageName, range]) => {
      const catalogs: WorkspaceCatalogs = { default: { [packageName]: range }, named: {} }
      return Result.match(subject(MANIFEST, { dependencies: { [packageName]: 'catalog:' } }, catalogs), {
        onFailure: () => false,
        onSuccess: (resolved) => Equal.equals(resolved, { dependencies: { [packageName]: range } }),
      })
    },
  )

  it.prop(
    '∀s_ExplicitDefaultCatalogName_≡CatalogVersion',
    { of: [nameArb, rangeArb], subject: resolveCatalogSpecs },
    (subject, [packageName, range]) => {
      const catalogs: WorkspaceCatalogs = { default: { [packageName]: range }, named: {} }
      return Result.match(subject(MANIFEST, { dependencies: { [packageName]: 'catalog:default' } }, catalogs), {
        onFailure: () => false,
        onSuccess: (resolved) => Equal.equals(resolved, { dependencies: { [packageName]: range } }),
      })
    },
  )

  it.prop(
    '∀c_NamedCatalogSpec_≡NamedCatalogVersion',
    { of: [nameArb, rangeArb, catalogNameArb], subject: resolveCatalogSpecs },
    (subject, [packageName, range, catalogName]) => {
      const catalogs: WorkspaceCatalogs = {
        default: { [packageName]: DEFAULT_SENTINEL },
        named: { [catalogName]: { [packageName]: range } },
      }
      return Result.match(
        subject(MANIFEST, { dependencies: { [packageName]: `catalog:${catalogName}` } }, catalogs),
        {
          onFailure: () => false,
          onSuccess: (resolved) => Equal.equals(resolved, { dependencies: { [packageName]: range } }),
        },
      )
    },
  )

  it.prop(
    '∀s_MissingDefaultCatalogEntry_⊥ResolvedSpec',
    { of: [nameArb], subject: resolveCatalogSpecs },
    (subject, [packageName]) =>
      Result.match(subject(MANIFEST, { dependencies: { [packageName]: 'catalog:' } }, emptyCatalogs), {
        onFailure: (failure) =>
          S.is(UnresolvedCatalogSpec)(failure) &&
          failure.manifest === MANIFEST &&
          failure.packageName === packageName &&
          failure.catalog === 'catalog:',
        onSuccess: () => false,
      }),
  )

  it.prop(
    '∀c_MissingNamedCatalogEntry_⊥ResolvedSpec',
    { of: [nameArb, catalogNameArb], subject: resolveCatalogSpecs },
    (subject, [packageName, catalogName]) => {
      const catalogs: WorkspaceCatalogs = { default: {}, named: { [catalogName]: {} } }
      return Result.match(subject(MANIFEST, { dependencies: { [packageName]: `catalog:${catalogName}` } }, catalogs), {
        onFailure: (failure) =>
          S.is(UnresolvedCatalogSpec)(failure) &&
          failure.manifest === MANIFEST &&
          failure.packageName === packageName &&
          failure.catalog === `catalog:${catalogName}`,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀f_NonRecordDependencyField_⊥ResolvedSpec',
    { of: [S.Literals(DEPENDENCY_FIELDS), S.Finite], subject: resolveCatalogSpecs },
    (subject, [field, value]) =>
      Result.match(subject(MANIFEST, { [field]: value }, emptyCatalogs), {
        onFailure: (failure) =>
          S.is(MalformedFixtureManifest)(failure) && failure.manifest === MANIFEST && failure.detail.includes(field),
        onSuccess: () => false,
      }),
  )

  it.prop(
    '∀v_PlainVersionSpec_≡UnchangedSpec',
    { of: [nameArb, rangeArb], subject: resolveCatalogSpecs },
    (subject, [packageName, range]) => {
      const catalogs: WorkspaceCatalogs = { default: { [packageName]: DEFAULT_SENTINEL }, named: {} }
      return Result.match(subject(MANIFEST, { dependencies: { [packageName]: range } }, catalogs), {
        onFailure: () => false,
        onSuccess: (resolved) => Equal.equals(resolved, { dependencies: { [packageName]: range } }),
      })
    },
  )
})

describe('parseFixtureManifest', () => {
  it.prop(
    '∀n_NonObjectManifestBytes_⊥ParsedManifest',
    { of: [S.Finite, nameArb], subject: parseFixtureManifest },
    (subject, [value, manifest]) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value))
      return Result.match(subject(manifest, bytes), {
        onFailure: (failure) => S.is(MalformedFixtureManifest)(failure) && failure.manifest === manifest,
        onSuccess: () => false,
      })
    },
  )
})

describe('parseWorkspaceCatalogs', () => {
  it.prop(
    '∀s_WorkspaceCatalogSection_≡DefaultCatalog',
    { of: [DependencySpecs], subject: parseWorkspaceCatalogs },
    (subject, [specs]) => Equal.equals(subject(`catalog: ${JSON.stringify(specs)}\n`), { default: specs, named: {} }),
  )

  it.prop(
    '∀s_WorkspaceCatalogsDefaultSection_≡DefaultCatalog',
    { of: [DependencySpecs], subject: parseWorkspaceCatalogs },
    (subject, [specs]) =>
      Equal.equals(subject(`catalogs: ${JSON.stringify({ default: specs })}\n`), { default: specs, named: {} }),
  )

  it.prop(
    '∀w_WorkspaceCatalogsSection_≡NamedCatalogsWithoutDefault',
    { of: [WorkspaceCatalogsYaml], subject: parseWorkspaceCatalogs },
    (subject, [workspace]) =>
      Equal.equals(subject(JSON.stringify(workspace)).named, Rec.remove(workspace.catalogs ?? {}, 'default')),
  )
})
