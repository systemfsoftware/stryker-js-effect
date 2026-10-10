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
  readonly releasedVersion: string
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

export type StaleBaselineFailure = {
  readonly kind: 'stale-baseline'
  readonly package: string
  readonly reason: string
  readonly next: string
  readonly releasedVersion: string
  readonly mainVersion: string
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
  | StaleBaselineFailure
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

const staleBaselineFailureOf = (pkg: PackageContracts): readonly StaleBaselineFailure[] => [{
  kind: 'stale-baseline',
  package: pkg.name,
  reason:
    `main declares ${pkg.mainVersion} while the released documents come from ${pkg.releasedVersion}, so they cannot bound what the next release of ${pkg.name} may change`,
  next: 'move the stryker-published flake input to the latest release tag and reinstall',
  releasedVersion: pkg.releasedVersion,
  mainVersion: pkg.mainVersion,
}]

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
  const releasedMajor = majorOf(pkg.releasedVersion)
  const requiredLevel = releasedMajor > 0 ? 'major' : 'minor'
  const requiredVersion = releasedMajor > 0 ? nextMajorOf(pkg.releasedVersion) : nextMinorOf(pkg.releasedVersion)
  const cleared = compareVersions({ left: declaredVersion, right: requiredVersion }) >= 0

  const changesWhen = (forgiven: boolean): readonly ContractVersionFailure[] =>
    documentNamesOf(pkg).flatMap((name) =>
      failuresForDocument({
        pkg,
        documentPath: `${pkg.directory}/contract/${name}`,
        released: documentNamed(pkg.releasedDocuments, name),
        committed: documentNamed(pkg.committedDocuments, name),
        cleared: forgiven,
        requiredLevel,
        requiredVersion,
        declaredVersion,
      })
    )

  if (pkg.mainVersion === pkg.releasedVersion) return changesWhen(cleared)
  return pending.length > 0 || changesWhen(false).length > 0 ? staleBaselineFailureOf(pkg) : []
}

export const evaluateContractLaw = (input: ContractLawInput): readonly ContractVersionFailure[] =>
  input.packages.flatMap((pkg) => failuresForPackage(pkg, input.pendingIntents))

const pointerLineOf = (pointer: string): string => (pointer === '' ? '/' : pointer)

export const renderFailure = (failure: ContractVersionFailure): string => {
  if (failure.kind === 'main-baseline-unavailable') {
    return [
      `error[CONTRACT-VERSION]: the version main declares is unavailable`,
      `  code: ${failure.kind}`,
      `  ref: ${failure.ref}`,
      `  reason: ${failure.reason}`,
      `  next: ${failure.next}`,
    ].join('\n')
  }
  if (failure.kind === 'stale-baseline') {
    return [
      `error[CONTRACT-VERSION]: the released baseline of ${failure.package} is stale`,
      `  code: ${failure.kind}`,
      `  package: ${failure.package}`,
      `  released: ${failure.releasedVersion}`,
      `  main: ${failure.mainVersion}`,
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
