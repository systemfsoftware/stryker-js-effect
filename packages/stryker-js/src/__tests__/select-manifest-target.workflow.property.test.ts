import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import type * as S from 'effect/Schema'

import {
  type ExportEntry,
  type ManifestTarget,
  ManifestTargetCommand,
  PackageExportRequest,
  PackageImportRequest,
  type PackageManifest,
} from '../import-closure.schema.js'
import { selectManifestTarget } from '../select-manifest-target.workflow.js'

type SelectSubject = (command: ManifestTargetCommand) => Result.Result<ManifestTarget, never>

type EntryMap = Readonly<Record<string, ExportEntry>>

const INVALID_SEGMENTS: readonly string[] = ['.', '..', 'node_modules', 'Node_Modules']

const SOURCE_CONDITION = '@systemfsoftware/source'

const textOf = (command: ManifestTargetCommand): string =>
  Match.value(command.request).pipe(
    Match.tagsExhaustive({
      PackageExportRequest: ({ subpath }) => subpath,
      PackageImportRequest: ({ specifier }) => specifier,
    }),
  )

const oneSegmentOf = (command: ManifestTargetCommand): string => textOf(command).replaceAll(/[/\\]/g, '')

const exportKeyOf = (subpath: string): string => (subpath.length === 0 ? '.' : `./${subpath}`)

const selected = (
  subject: SelectSubject,
  manifest: PackageManifest,
  request: PackageExportRequest | PackageImportRequest,
): string =>
  Result.match(subject(ManifestTargetCommand.make({ manifest, request })), {
    onFailure: () => 'refused',
    onSuccess: (target) =>
      Match.value(target).pipe(
        Match.tagsExhaustive({
          ManifestPathTarget: ({ target: path }) => `path:${path}`,
          ManifestPackageTarget: ({ specifier }) => `package:${specifier}`,
          ManifestTargetMissing: () => 'missing',
        }),
      ),
  })

const exported = (
  subject: SelectSubject,
  command: ManifestTargetCommand,
  exports: string | EntryMap,
  subpath: string,
) => selected(subject, { ...command.manifest, exports }, PackageExportRequest.make({ subpath }))

const imported = (subject: SelectSubject, command: ManifestTargetCommand, imports: S.Json, specifier: string) =>
  selected(subject, { ...command.manifest, imports }, PackageImportRequest.make({ specifier }))

describe('selectManifestTarget', () => {
  it.prop(
    '∀c_ExportConditions_≡SourceConditionBeforeEarlierConditions',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const subpath = textOf(command)
      const conditions = { default: './default.js', [SOURCE_CONDITION]: './source.ts' }
      return exported(subject, command, { [exportKeyOf(subpath)]: conditions }, subpath) === 'path:./source.ts'
    },
  )

  it.prop(
    '∀c_ExportSubpath_≡ExactKeyBeforeWildcardWhichSubstitutesTheSubpath',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const subpath = `x$&${oneSegmentOf(command)}`
      return [
        exported(subject, command, { './*': './wild/*', [`./${subpath}`]: './exact.js' }, subpath),
        exported(subject, command, { './*': './wild/*' }, subpath),
      ].join('|') === `path:./exact.js|path:./wild/${subpath}`
    },
  )

  it.prop(
    '∀c_ExportPatterns_≡LongestPrefixBeatsTheRootWildcardInEitherKeyOrder',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const captured = `$&${oneSegmentOf(command)}x`
      const subpath = `features/${captured}`
      return [
        exported(subject, command, { './*': './wild/*', './features/*': './feat/*.js' }, subpath),
        exported(subject, command, { './features/*': './feat/*.js', './*': './wild/*' }, subpath),
      ].every((target) => target === `path:./feat/${captured}.js`)
    },
  )

  it.prop(
    '∀c_ExportPattern_≡AnyPatternKeyResolvesWithoutTheRootWildcard',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const captured = `${oneSegmentOf(command)}x`
      return [
        exported(subject, command, { './features/*.js': './feat/*.ts' }, `features/${captured}.js`),
        exported(subject, command, { './features/*.js': './feat/*.ts' }, `other/${captured}.js`),
      ].join('|') === `path:./feat/${captured}.ts|missing`
    },
  )

  it.prop(
    '∀c_MapTarget_≡MissingWhenASegmentAfterTheLeadingDotSlashIsDotDotDotOrNodeModules',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const subpath = `x${oneSegmentOf(command)}`
      const specifier = `#${subpath}`
      const outcomes = INVALID_SEGMENTS.flatMap((segment) => [
        exported(subject, command, { [`./${subpath}`]: `./a/${segment}/b.js` }, subpath),
        exported(subject, command, { './*': './src/*' }, `${segment}/${subpath}`),
        imported(subject, command, { [specifier]: `./a/${segment}/b.js` }, specifier),
        imported(subject, command, { '#*': './src/*' }, `#${segment}/${subpath}`),
      ])
      return [
        outcomes.every((outcome) => outcome === 'missing'),
        exported(subject, command, { [`./${subpath}`]: './a/b.js' }, subpath) === 'path:./a/b.js',
        imported(subject, command, { [specifier]: './a/b.js' }, specifier) === 'path:./a/b.js',
      ].every((holds) => holds)
    },
  )

  it.prop(
    '∀c_StringExports_≡RootOnlyWhateverMainAndModuleSay',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) =>
      [
        exported(subject, command, './index.js', ''),
        exported(subject, command, './index.js', `x${textOf(command)}`),
      ].join('|') === 'path:./index.js|missing',
  )

  it.prop(
    '∀c_ImportSpecifier_≡ExactKeyBeforeAnyPattern',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const specifier = `#${textOf(command)}`
      return imported(subject, command, { '#*': './any/*', [specifier]: './exact.ts' }, specifier) === 'path:./exact.ts'
    },
  )

  it.prop(
    '∀c_ImportPatterns_≡LongestPrefixWinsInEitherKeyOrderAndSubstitutesTheCapture',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const captured = `$&${oneSegmentOf(command)}x`
      const specifier = `#a/${captured}`
      return [
        imported(subject, command, { '#*': './short/*', '#a/*': './long/*' }, specifier),
        imported(subject, command, { '#a/*': './long/*', '#*': './short/*' }, specifier),
      ].every((target) => target === `path:./long/${captured}`)
    },
  )

  it.prop(
    '∀c_ImportConditions_≡SourceConditionBeforeEarlierConditions',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const specifier = `#${textOf(command)}`
      const conditions = { default: './default.js', [SOURCE_CONDITION]: './source.ts' }
      return imported(subject, command, { [specifier]: conditions }, specifier) === 'path:./source.ts'
    },
  )

  it.prop(
    '∀c_ImportTarget_≡PackageWhenBareMissingWhenNotPackageRelative',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const specifier = `#${textOf(command)}`
      return [
        imported(subject, command, { [specifier]: `dep${textOf(command)}` }, specifier),
        ...['', '../up.js', '/abs.js', '#other'].map((target) =>
          imported(subject, command, { [specifier]: target }, specifier)
        ),
      ].join('|') === `package:dep${textOf(command)}|missing|missing|missing|missing`
    },
  )

  it.prop(
    '∀c_ManifestWithoutImports_≡EveryImportMissingWhateverItsExports',
    { of: [ManifestTargetCommand], subject: selectManifestTarget },
    (subject, [command]) => {
      const { imports: _dropped, ...withoutImports } = command.manifest
      return selected(subject, withoutImports, PackageImportRequest.make({ specifier: `#${textOf(command)}` })) ===
        'missing'
    },
  )
})
