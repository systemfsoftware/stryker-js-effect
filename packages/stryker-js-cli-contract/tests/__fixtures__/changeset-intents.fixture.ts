import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { parse } from 'yaml'

export type Bump = 'none' | 'patch' | 'minor' | 'major'

export type ChangeIntent = {
  readonly package: string
  readonly bump: Bump
}

export type ChangesetFile = {
  readonly name: string
  readonly markdown: string
}

export type ChangesetInventory = {
  readonly files: readonly ChangesetFile[]
  readonly ledgerYamlText: string
}

export type BumpRequest = {
  readonly version: string
  readonly bump: Bump
}

export type NextVersionRequest = {
  readonly version: string
  readonly intents: readonly ChangeIntent[]
}

export type VersionOrder = {
  readonly left: string
  readonly right: string
}

const CHANGESET_EXTENSION = '.md'
const CHANGESET_README = 'README.md'
const FRONT_MATTER_FENCE = '---'

const BUMPS: readonly string[] = ['none', 'patch', 'minor', 'major']

const LEVEL_BY_BUMP: Record<Bump, number> = { none: 0, patch: 1, minor: 2, major: 3 }

const FrontMatter = S.Record(S.String, S.Unknown)

const Ledger = S.Record(S.String, S.Struct({ intents: S.Array(S.String) }))

const PackageManifest = S.Struct({ version: S.String })

const JsonManifest = S.fromJsonString(PackageManifest)

const ShippedManifest = S.fromJsonString(S.Struct({ name: S.String, files: S.String.pipe(S.Array, S.optional) }))

const WorkspaceManifest = S.Struct({ packages: S.Array(S.String) })

export const decodeShippedManifest = (
  text: string,
): Result.Result<{ readonly name: string; readonly files: readonly string[] }, S.SchemaError> =>
  Result.map(S.decodeResult(ShippedManifest)(text), (manifest) => ({
    name: manifest.name,
    files: manifest.files ?? [],
  }))

export const decodeWorkspaceGlobs = (yamlText: string): Result.Result<readonly string[], S.SchemaError> =>
  Result.map(S.decodeUnknownResult(WorkspaceManifest)(parse(yamlText)), (workspace) => workspace.packages)

const isBump = (value: unknown): value is Bump => typeof value === 'string' && BUMPS.includes(value)

const frontMatterOf = (markdown: string): string | undefined => {
  const lines = markdown.split(/\r?\n/)
  if (lines.length === 0 || lines[0].trim() !== FRONT_MATTER_FENCE) return undefined
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FRONT_MATTER_FENCE)
  return end < 0 ? undefined : lines.slice(1, end).join('\n')
}

export const parseIntentsMarkdown = (markdown: string): readonly ChangeIntent[] => {
  const frontMatter = frontMatterOf(markdown)
  if (frontMatter === undefined) return []
  const decoded = S.decodeUnknownResult(FrontMatter)(parse(frontMatter))
  if (Result.isFailure(decoded)) return []
  return Object.entries(decoded.success).flatMap((
    [name, value],
  ) => (isBump(value) ? [{ package: name, bump: value }] : []))
}

const consumedStemsOf = (ledgerYamlText: string): Result.Result<ReadonlySet<string>, string> => {
  const decoded = S.decodeUnknownResult(Ledger)(parse(ledgerYamlText))
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure.message)
  return Result.succeed(new Set(Object.values(decoded.success).flatMap((entry) => entry.intents)))
}

const stemOf = (
  name: string,
): string => (name.endsWith(CHANGESET_EXTENSION) ? name.slice(0, -CHANGESET_EXTENSION.length) : name)

export const pendingIntentsOf = (
  inventory: ChangesetInventory,
): Result.Result<readonly ChangeIntent[], string> => {
  const consumed = consumedStemsOf(inventory.ledgerYamlText)
  if (Result.isFailure(consumed)) return Result.fail(consumed.failure)
  return Result.succeed(
    inventory.files
      .filter((file) => file.name !== CHANGESET_README && !consumed.success.has(stemOf(file.name)))
      .flatMap((file) => parseIntentsMarkdown(file.markdown)),
  )
}

export const decodePackageVersion = (text: string): Result.Result<string, S.SchemaError> =>
  Result.map(S.decodeResult(JsonManifest)(text), (manifest) => manifest.version)

const segmentOf = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

type VersionParts = {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

const partsOf = (version: string): VersionParts => {
  const segments = version.split('.')
  return { major: segmentOf(segments[0]), minor: segmentOf(segments[1]), patch: segmentOf(segments[2]) }
}

const versionOf = (parts: VersionParts): string => `${parts.major}.${parts.minor}.${parts.patch}`

export const majorOf = (version: string): number => {
  const major = Number.parseInt(version.split('.')[0], 10)
  return Number.isNaN(major) ? -1 : major
}

export const nextMajorOf = (version: string): string => {
  const parts = partsOf(version)
  return versionOf({ major: parts.major + 1, minor: 0, patch: 0 })
}

export const nextMinorOf = (version: string): string => {
  const parts = partsOf(version)
  return versionOf({ major: parts.major, minor: parts.minor + 1, patch: 0 })
}

export const compareVersions = (order: VersionOrder): number => {
  const left = partsOf(order.left)
  const right = partsOf(order.right)
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}

export const bumpVersion = (request: BumpRequest): string => {
  const parts = partsOf(request.version)
  if (request.bump === 'major') return versionOf({ major: parts.major + 1, minor: 0, patch: 0 })
  if (request.bump === 'minor') return versionOf({ major: parts.major, minor: parts.minor + 1, patch: 0 })
  if (request.bump === 'patch') return versionOf({ major: parts.major, minor: parts.minor, patch: parts.patch + 1 })
  return versionOf(parts)
}

const highestBumpOf = (bumps: readonly Bump[]): Bump =>
  bumps.reduce<Bump>((highest, bump) => (LEVEL_BY_BUMP[bump] > LEVEL_BY_BUMP[highest] ? bump : highest), 'none')

export const declaredNextVersion = (request: NextVersionRequest): string =>
  bumpVersion({
    version: request.version,
    bump: highestBumpOf(request.intents.map((intent) => intent.bump)),
  })
