import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { Json } from 'effect/Schema'

import {
  type ChangeIntent,
  compareVersions,
  declaredNextVersion,
  majorOf,
  nextMajorOf,
  nextMinorOf,
} from './changeset-intents.fixture.js'
import {
  compareDocuments,
  type Incompatibility,
  type StatedStreamVersion,
  type StreamVersionDeclaration,
  streamVersionOf,
  wasIncompatible,
} from './contract-compat.fixture.js'

export type ContractDocument = {
  readonly name: string
  readonly document: Json
}

export type PackageContracts = {
  readonly name: string
  readonly directory: string
  readonly mainVersion: string
  readonly committedVersion: string
  readonly releasedDocuments: readonly ContractDocument[]
  readonly committedDocuments: readonly ContractDocument[]
}

export type ContractLawInput = {
  readonly packages: readonly PackageContracts[]
  readonly pendingIntents: readonly ChangeIntent[]
}

export type ContractChangeFailure = {
  readonly kind: 'contract-change'
  readonly package: string
  readonly document: string
  readonly pointer: string
  readonly reason: string
  readonly requiredLevel: 'minor' | 'major'
  readonly requiredVersion: string
  readonly declaredVersion: string
}

export type StreamVersionFailure = {
  readonly kind: 'stream-version'
  readonly package: string
  readonly document: string
  readonly pointer: string
  readonly reason: string
  readonly releasedStreamVersion: string
  readonly declaredStreamVersion: string
}

const releaseNextOf = (pkg: string): string =>
  `add a changeset for ${pkg} and merge the version PR, so a release writes a version its manifest has not declared before`

const baselineFields = { package: S.String, manifest: S.String, version: S.String }

export class NoVersionCommit extends S.TaggedError<NoVersionCommit>()('NoVersionCommit', baselineFields) {
  readonly code = 'no-version-commit'
  get reason(): string {
    return `no commit on main's first-parent history sets "version": "${this.version}" in ${this.manifest}, so the commit that released ${this.version} cannot be found`
  }
  get next(): string {
    return releaseNextOf(this.package)
  }
}

export class HistoryTruncated extends S.TaggedError<HistoryTruncated>()('HistoryTruncated', {
  ...baselineFields,
  boundary: S.String,
}) {
  readonly code = 'history-truncated'
  get reason(): string {
    return `the history of this checkout ends at ${this.boundary}, so whether that commit set ${this.version} in ${this.manifest} cannot be read`
  }
  get next(): string {
    return 'git fetch --unshallow origin main'
  }
}

export class VersionUnchanged extends S.TaggedError<VersionUnchanged>()('VersionUnchanged', {
  ...baselineFields,
  commit: S.String,
}) {
  readonly code = 'version-unchanged'
  get reason(): string {
    return `${this.commit} rewrites the line declaring ${this.version} in ${this.manifest} while its parent already declares ${this.version}, so it cannot be told apart from the commit that released ${this.version}`
  }
  get next(): string {
    return releaseNextOf(this.package)
  }
}

export class VersionRollback extends S.TaggedError<VersionRollback>()('VersionRollback', {
  ...baselineFields,
  commit: S.String,
  parentVersion: S.String,
}) {
  readonly code = 'version-rollback'
  get reason(): string {
    return `${this.commit} moves ${this.manifest} back from ${this.parentVersion} to ${this.version}, so its documents are not the ones ${this.version} shipped`
  }
  get next(): string {
    return releaseNextOf(this.package)
  }
}

export type ReleasedBaselineUnavailable = NoVersionCommit | HistoryTruncated | VersionUnchanged | VersionRollback

export type VersionCommitParent =
  | { readonly status: 'outside-history' }
  | { readonly status: 'no-manifest' }
  | { readonly status: 'declares'; readonly version: string }

export type VersionCommitEvidence = {
  readonly package: string
  readonly manifest: string
  readonly mainVersion: string
  readonly candidate:
    | { readonly commit: string; readonly declares: string | undefined; readonly parent: VersionCommitParent }
    | undefined
}

export type MainBaselineUnavailableFailure = {
  readonly kind: 'main-baseline-unavailable'
  readonly ref: string
  readonly reason: string
  readonly next: string
}

export type ContractVersionFailure =
  | ContractChangeFailure
  | StreamVersionFailure
  | ReleasedBaselineUnavailable
  | MainBaselineUnavailableFailure

const ABSENT_STREAM_VERSION = 'absent'

const documentNamed = (documents: readonly ContractDocument[], name: string): Json | undefined =>
  documents.find((document) => document.name === name)?.document

const documentNamesOf = (pkg: PackageContracts): readonly string[] =>
  [
    ...new Set([
      ...pkg.releasedDocuments.map((document) => document.name),
      ...pkg.committedDocuments.map((document) => document.name),
    ]),
  ].sort()

const declaredStreamVersionOf = (declaration: StreamVersionDeclaration): string => {
  if (declaration.status === 'declared') return declaration.version
  if (declaration.status === 'absent') return ABSENT_STREAM_VERSION
  return `disagreeing: ${declaration.versions.join(', ')}`
}

const streamPointerOf = (declaration: StreamVersionDeclaration): string =>
  declaration.status === 'declared' ? declaration.pointer : ''

const streamReasonOf = (released: StatedStreamVersion, committed: StreamVersionDeclaration): string => {
  const releasedText = released.status === 'declared'
    ? `the released document declares stream version ${released.version}`
    : `the rejected document declares disagreeing stream versions: ${released.versions.join(', ')}`
  const committedText = committed.status === 'absent'
    ? 'the committed document declares none'
    : `the committed document declares ${declaredStreamVersionOf(committed)}`
  return `${releasedText} and ${committedText}; a breaking stream change requires a higher stream version major`
}

const streamFailureOf = (context: {
  readonly pkg: PackageContracts
  readonly documentPath: string
  readonly released: Json | undefined
  readonly committed: Json | undefined
  readonly incompatible: boolean
}): readonly StreamVersionFailure[] => {
  if (!context.incompatible || context.released === undefined) return []
  const released = streamVersionOf(context.released)
  if (released.status === 'absent') return []
  const committed: StreamVersionDeclaration = context.committed === undefined
    ? { status: 'absent' }
    : streamVersionOf(context.committed)
  if (
    released.status === 'declared' &&
    committed.status === 'declared' &&
    majorOf(committed.version) > majorOf(released.version)
  ) {
    return []
  }
  return [{
    kind: 'stream-version',
    package: context.pkg.name,
    document: context.documentPath,
    pointer: streamPointerOf(committed),
    reason: streamReasonOf(released, committed),
    releasedStreamVersion: released.status === 'declared' ? released.version : ABSENT_STREAM_VERSION,
    declaredStreamVersion: declaredStreamVersionOf(committed),
  }]
}

const changeFailuresOf = (context: {
  readonly pkg: PackageContracts
  readonly documentPath: string
  readonly incompatibilities: readonly Incompatibility[]
  readonly requiredLevel: 'minor' | 'major'
  readonly requiredVersion: string
  readonly declaredVersion: string
}): readonly ContractChangeFailure[] =>
  context.incompatibilities.map((incompatibility) => ({
    kind: 'contract-change',
    package: context.pkg.name,
    document: context.documentPath,
    pointer: incompatibility.pointer,
    reason: incompatibility.reason,
    requiredLevel: context.requiredLevel,
    requiredVersion: context.requiredVersion,
    declaredVersion: context.declaredVersion,
  }))

export const versionCommitOf = (
  evidence: VersionCommitEvidence,
): Result.Result<string, ReleasedBaselineUnavailable> => {
  const fields = { package: evidence.package, manifest: evidence.manifest, version: evidence.mainVersion }
  const candidate = evidence.candidate
  if (candidate === undefined || candidate.declares !== fields.version) {
    return Result.fail(NoVersionCommit.make(fields))
  }
  const parent = candidate.parent
  if (parent.status === 'outside-history') {
    return Result.fail(HistoryTruncated.make({ ...fields, boundary: candidate.commit }))
  }
  if (parent.status === 'no-manifest') return Result.succeed(candidate.commit)
  const order = compareVersions({ left: parent.version, right: fields.version })
  if (order < 0) return Result.succeed(candidate.commit)
  if (order === 0) return Result.fail(VersionUnchanged.make({ ...fields, commit: candidate.commit }))
  return Result.fail(VersionRollback.make({ ...fields, commit: candidate.commit, parentVersion: parent.version }))
}

export const mainBaselineUnavailableOf = (context: {
  readonly ref: string
  readonly detail: string
}): MainBaselineUnavailableFailure => ({
  kind: 'main-baseline-unavailable',
  ref: context.ref,
  reason: `git merge-base ${context.ref} HEAD failed (${context.detail}), so the version main declares cannot be read`,
  next: 'git fetch origin main',
})

const failuresForDocument = (context: {
  readonly pkg: PackageContracts
  readonly documentPath: string
  readonly released: Json | undefined
  readonly committed: Json | undefined
  readonly cleared: boolean
  readonly requiredLevel: 'minor' | 'major'
  readonly requiredVersion: string
  readonly declaredVersion: string
}): readonly ContractVersionFailure[] => {
  const comparison = compareDocuments({ released: context.released, committed: context.committed })
  const reported: readonly Incompatibility[] = comparison.verdict === 'unreadable'
    ? [{ pointer: '', reason: comparison.reason }]
    : context.cleared
    ? []
    : comparison.incompatibilities
  const changes = changeFailuresOf({
    pkg: context.pkg,
    documentPath: context.documentPath,
    incompatibilities: reported,
    requiredLevel: context.requiredLevel,
    requiredVersion: context.requiredVersion,
    declaredVersion: context.declaredVersion,
  })
  const stream = streamFailureOf({
    pkg: context.pkg,
    documentPath: context.documentPath,
    released: context.released,
    committed: context.committed,
    incompatible: wasIncompatible(comparison),
  })
  return [...changes, ...stream]
}

const failuresForPackage = (
  pkg: PackageContracts,
  pendingIntents: readonly ChangeIntent[],
): readonly ContractVersionFailure[] => {
  const pending = pendingIntents.filter((intent) => intent.package === pkg.name)
  const declaredVersion = declaredNextVersion({ version: pkg.committedVersion, intents: pending })
  const mainMajor = majorOf(pkg.mainVersion)
  const requiredLevel = mainMajor > 0 ? 'major' : 'minor'
  const requiredVersion = mainMajor > 0 ? nextMajorOf(pkg.mainVersion) : nextMinorOf(pkg.mainVersion)
  const cleared = compareVersions({ left: declaredVersion, right: requiredVersion }) >= 0

  return documentNamesOf(pkg).flatMap((name) =>
    failuresForDocument({
      pkg,
      documentPath: `${pkg.directory}/contract/${name}`,
      released: documentNamed(pkg.releasedDocuments, name),
      committed: documentNamed(pkg.committedDocuments, name),
      cleared,
      requiredLevel,
      requiredVersion,
      declaredVersion,
    })
  )
}

export const evaluateContractLaw = (input: ContractLawInput): readonly ContractVersionFailure[] =>
  input.packages.flatMap((pkg) => failuresForPackage(pkg, input.pendingIntents))

const pointerLineOf = (pointer: string): string => (pointer === '' ? '/' : pointer)

export const renderFailure = (failure: ContractVersionFailure): string => {
  if ('_tag' in failure) {
    return [
      `error[CONTRACT-VERSION]: the released baseline of ${failure.package} is unavailable`,
      `  code: ${failure.code}`,
      `  package: ${failure.package}`,
      `  version: ${failure.version}`,
      `  reason: ${failure.reason}`,
      `  next: ${failure.next}`,
    ].join('\n')
  }
  if (failure.kind === 'main-baseline-unavailable') {
    return [
      `error[CONTRACT-VERSION]: the version main declares is unavailable`,
      `  code: ${failure.kind}`,
      `  ref: ${failure.ref}`,
      `  reason: ${failure.reason}`,
      `  next: ${failure.next}`,
    ].join('\n')
  }
  if (failure.kind === 'stream-version') {
    return [
      `error[CONTRACT-VERSION]: incompatible contract change in ${failure.document}`,
      `  code: ${failure.kind}`,
      `  package: ${failure.package}`,
      `  document: ${failure.document}`,
      `  pointer: ${pointerLineOf(failure.pointer)}`,
      `  reason: ${failure.reason}`,
      `  released stream version: ${failure.releasedStreamVersion}`,
      `  declared stream version: ${failure.declaredStreamVersion}`,
    ].join('\n')
  }
  return [
    `error[CONTRACT-VERSION]: incompatible contract change in ${failure.document}`,
    `  code: ${failure.kind}`,
    `  package: ${failure.package}`,
    `  document: ${failure.document}`,
    `  pointer: ${pointerLineOf(failure.pointer)}`,
    `  reason: ${failure.reason}`,
    `  required: a ${failure.requiredLevel} changeset intent (${failure.package} must declare ${failure.requiredVersion} or higher)`,
    `  declared: ${failure.declaredVersion}`,
  ].join('\n')
}
