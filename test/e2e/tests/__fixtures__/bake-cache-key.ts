import { createHash, type Hash } from 'node:crypto'

import type { MicroVM } from '@systemfsoftware/effect-microsandbox'
import { Option, Schema } from 'effect'

const PACKED_TARBALL_VERSION = /-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/
const STDERR_TAIL_CHARS = 4000

export type FileBytes = {
  readonly relativePath: string
  readonly bytes: Uint8Array
}

export type BakedInput = {
  readonly baseImage: string
  readonly bakeScript: Uint8Array
  readonly packs: ReadonlyArray<{ readonly fileName: string; readonly files: ReadonlyArray<FileBytes> }>
  readonly fixtures: ReadonlyArray<{ readonly fixtureId: string; readonly files: ReadonlyArray<FileBytes> }>
}

export type PackedPackage = {
  readonly name: string
  readonly version: string
  readonly fileName: string
  readonly tarballPath: string
}

export type PackedPackageLookup =
  | { readonly _tag: 'Found'; readonly pack: PackedPackage }
  | { readonly _tag: 'MissingTarball'; readonly prefix: string; readonly directory: string }
  | { readonly _tag: 'UnreadableVersion'; readonly fileName: string }

export type JobExitVerdict = { readonly _tag: 'Exited'; readonly code: number } | { readonly _tag: 'Signaled' }

export type TurboDryClosure =
  | { readonly _tag: 'Closure'; readonly packages: ReadonlyArray<string> }
  | { readonly _tag: 'Malformed' }

export type TelemetryInput = Readonly<Record<string, string | undefined>>

export const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

export const tailOf = (text: string): string => text.slice(-STDERR_TAIL_CHARS)

export const isInstallOutput = (relativePath: string): boolean => relativePath.split('/').includes('node_modules')

const basenameOf = (relativePath: string): string => relativePath.split('/').pop() ?? relativePath

export const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalJson)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    )
  }
  return value
}

const canonicalBytes = (relativePath: string, bytes: Uint8Array): Uint8Array =>
  basenameOf(relativePath) === 'package.json'
    ? new TextEncoder().encode(JSON.stringify(canonicalJson(JSON.parse(decodeUtf8(bytes)))))
    : bytes

const hashTree = (hash: Hash, label: string, files: ReadonlyArray<FileBytes>): void => {
  for (const file of [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    hash.update(`${label}\0${file.relativePath}\0`)
    hash.update(canonicalBytes(file.relativePath, file.bytes))
    hash.update('\0')
  }
}

export const bakeCacheKey = (input: BakedInput): string => {
  const hash = createHash('sha256')
  hash.update(`image\0${input.baseImage}\0`)
  hash.update('bake\0')
  hash.update(input.bakeScript)
  hash.update('\0')
  for (const pack of [...input.packs].sort((left, right) => left.fileName.localeCompare(right.fileName))) {
    hashTree(hash, `pack\0${pack.fileName}`, pack.files)
  }
  for (const fixture of [...input.fixtures].sort((left, right) => left.fixtureId.localeCompare(right.fixtureId))) {
    hashTree(hash, `fixture\0${fixture.fixtureId}`, fixture.files)
  }
  return hash.digest('hex')
}

export const classifyJobExit = (completion: MicroVM.JobCompletion): JobExitVerdict =>
  completion.status._tag === 'JobExited'
    ? { _tag: 'Exited', code: completion.status.code }
    : { _tag: 'Signaled' }

const TurboTask = Schema.Struct({
  command: Schema.optional(Schema.String),
  package: Schema.optional(Schema.String),
  taskId: Schema.String,
})

const TurboDryRun = Schema.Struct({ tasks: Schema.Array(TurboTask) })

export const resolveTurboDryClosure = (stdout: string): TurboDryClosure => {
  const jsonStart = stdout.indexOf('{')
  if (jsonStart >= 0) {
    let parsed: unknown
    try {
      parsed = JSON.parse(stdout.slice(jsonStart))
    } catch {
      parsed = undefined
    }
    const decoded = Schema.decodeUnknownOption(TurboDryRun)(parsed)
    if (Option.isSome(decoded)) {
      const packages = new Set<string>()
      for (const task of decoded.value.tasks) {
        if ((task.command === 'build' || task.taskId.endsWith('#build')) && task.package !== undefined) {
          packages.add(task.package)
        }
      }
      return { _tag: 'Closure', packages: [...packages].sort() }
    }
  }
  return { _tag: 'Malformed' }
}

export const packedTarballOf = (
  fileNames: ReadonlyArray<string>,
  packageName: string,
  directory: string,
): PackedPackageLookup => {
  const prefix = `${packageName.slice(1).replace('/', '-')}-`
  const fileName = fileNames.find((candidate) => candidate.startsWith(prefix) && candidate.endsWith('.tgz'))
  if (fileName === undefined) {
    return { _tag: 'MissingTarball', prefix, directory }
  }
  const version = PACKED_TARBALL_VERSION.exec(fileName)?.[1]
  if (version === undefined) {
    return { _tag: 'UnreadableVersion', fileName }
  }
  return {
    _tag: 'Found',
    pack: { name: packageName, version, fileName, tarballPath: `${directory}/${fileName}` },
  }
}

export const guestTelemetryEnvironment = (env: TelemetryInput): Record<string, string> => ({
  OTEL_ENABLED: env['OTEL_ENABLED'] ?? 'false',
  OTEL_SERVICE_NAME: env['OTEL_SERVICE_NAME'] ?? 'stryker-e2e',
  OTEL_EXPORTER_OTLP_ENDPOINT: (env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://127.0.0.1:4318')
    .replace('127.0.0.1', 'host.microsandbox.internal')
    .replace('localhost', 'host.microsandbox.internal'),
})
