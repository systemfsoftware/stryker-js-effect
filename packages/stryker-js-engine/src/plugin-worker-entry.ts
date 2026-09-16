import { type WorkerPluginKind, type WorkerPluginSpawn } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'

import { planWorkerEntry, WorkerEntryCommand, WorkerEntryMissing } from './plan-worker-entry.workflow.js'
import { ManifestDocument, ManifestDocumentJson } from './plugin-worker-entry.schema.js'
import { findByKindAndName, type LoadedPlugins, type PluginSource } from './Plugins.js'

const PACKAGE_MANIFEST = 'package.json'

const asString = (value: unknown): Option.Option<string> =>
  Option.fromUndefinedOr(value).pipe(Option.filter(Predicate.isString))

const asStringRecord = (value: unknown): Option.Option<Record<string, string>> =>
  S.decodeUnknownOption(S.Record(S.String, S.String))(value)

const asDocument = (value: unknown): Option.Option<Record<string, unknown>> =>
  S.decodeUnknownOption(ManifestDocument)(value)

const binRelativeEntrypoint = (document: Record<string, unknown>): Option.Option<string> =>
  Option.flatMap(
    Option.fromUndefinedOr(document['bin']),
    (bin) =>
      Option.orElse(asString(bin), () =>
        Option.flatMap(asStringRecord(bin), (commands) => Option.fromUndefinedOr(Object.values(commands)[0]))),
  )

const workerExportRelativeEntrypoint = (document: Record<string, unknown>): Option.Option<string> =>
  Option.flatMap(
    Option.flatMap(Option.fromUndefinedOr(document['exports']), asDocument),
    (conditions) => Option.fromUndefinedOr(conditions['./worker']),
  ).pipe(
    Option.flatMap((worker) =>
      Option.orElse(asString(worker), () =>
        Option.flatMap(asDocument(worker), (branches) => asString(branches['default'])))
    ),
  )

const manifestDocumentAt = (
  file: string,
): Effect.Effect<Record<string, unknown> | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => undefined))
    return Option.match(Option.fromUndefinedOr(text), {
      onNone: () => undefined,
      onSome: (content) => Option.getOrUndefined(S.decodeUnknownOption(ManifestDocumentJson)(content)),
    })
  })

interface FoundManifest {
  readonly directory: string
  readonly document: Record<string, unknown>
}

const manifestInDirectory = (
  directory: string,
): Effect.Effect<FoundManifest | undefined, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const document = yield* manifestDocumentAt(path.join(directory, PACKAGE_MANIFEST))
    if (document !== undefined) {
      return { directory, document }
    }
    return yield* manifestAboveDirectory(directory)
  })

const manifestAboveDirectory = (
  directory: string,
): Effect.Effect<FoundManifest | undefined, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const parent = path.dirname(directory)
    if (parent === directory) {
      return undefined
    }
    return yield* manifestInDirectory(parent)
  })

const missingEntry = (pluginName: string, specifier: string): WorkerEntryMissing =>
  new WorkerEntryMissing({ pluginName, specifier })

const requiredSource = (params: {
  readonly loaded: Pick<LoadedPlugins, 'pluginSources'>
  readonly kind: WorkerPluginKind
  readonly name: string
}): Effect.Effect<PluginSource, WorkerEntryMissing> =>
  Option.match(findByKindAndName(params.loaded.pluginSources, params.kind, params.name), {
    onNone: () => Effect.fail(missingEntry(params.name, `${params.kind}:${params.name}`)),
    onSome: (source) => Effect.succeed(source),
  })

const requiredManifest = (
  path: Path.Path,
  source: PluginSource,
): Effect.Effect<FoundManifest, WorkerEntryMissing, FileSystem.FileSystem | Path.Path> =>
  manifestInDirectory(path.dirname(source.modulePath)).pipe(
    Effect.flatMap((manifest) =>
      Option.match(Option.fromUndefinedOr(manifest), {
        onNone: () => Effect.fail(missingEntry(source.name, source.modulePath)),
        onSome: (found) => Effect.succeed(found),
      })
    ),
  )

export const resolvePluginWorkerEntry = (params: {
  readonly loaded: Pick<LoadedPlugins, 'pluginSources'>
  readonly kind: WorkerPluginKind
  readonly name: string
}): Effect.Effect<WorkerPluginSpawn, WorkerEntryMissing, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const source = yield* requiredSource(params)
    const manifest = yield* requiredManifest(path, source)
    const entry = yield* Effect.fromResult(
      planWorkerEntry(
        new WorkerEntryCommand({
          kind: params.kind,
          pluginName: source.name,
          modulePath: source.modulePath,
          bin: Option.getOrUndefined(binRelativeEntrypoint(manifest.document)),
          workerExport: Option.getOrUndefined(workerExportRelativeEntrypoint(manifest.document)),
        }),
      ),
    )
    return {
      kind: params.kind,
      field: Match.value(entry).pipe(
        Match.tag('WorkerEntryFromBin', (): 'bin' => 'bin'),
        Match.tag('WorkerEntryFromWorkerExport', (): 'workerExport' => 'workerExport'),
        Match.exhaustive,
      ),
      entrypoint: path.resolve(manifest.directory, entry.relativeEntrypoint),
    }
  })
