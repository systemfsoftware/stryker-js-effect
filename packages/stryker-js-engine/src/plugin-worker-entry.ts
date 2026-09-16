import { type WorkerPluginKind, type WorkerPluginSpawn } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  planWorkerEntry,
  WorkerEntryCommand,
  type WorkerEntryDecision,
  WorkerEntryMissing,
  WorkerEntryOutsidePackage,
  WorkerManifestMalformed,
} from './plan-worker-entry.workflow.js'
import { ManifestDocument, ManifestDocumentJson } from './plugin-worker-entry.schema.js'
import { findByKindAndName, type LoadedPlugins, type PluginSource } from './Plugins.js'

const PACKAGE_MANIFEST = 'package.json'

const MANIFEST_WALK_LIMIT = 10

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
        Option.flatMap(asStringRecord(bin), (commands) =>
          Option.orElse(
            Option.flatMap(asString(document['name']), (name) => Option.fromUndefinedOr(commands[name])),
            () => Option.fromUndefinedOr(Object.values(commands)[0]),
          ))),
  )

const workerExportRelativeEntrypoint = (document: Record<string, unknown>): Option.Option<string> =>
  Option.flatMap(
    Option.flatMap(Option.fromUndefinedOr(document['exports']), asDocument),
    (conditions) => Option.fromUndefinedOr(conditions['./worker']),
  ).pipe(
    Option.flatMap((worker) =>
      Option.orElse(asString(worker), () =>
        Option.flatMap(asDocument(worker), (branches) =>
          Option.orElse(asString(branches['node']), () =>
            asString(branches['default']))))
    ),
  )

const manifestDocumentAt = (
  file: string,
  pluginName: string,
): Effect.Effect<Record<string, unknown> | undefined, WorkerManifestMalformed, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => undefined))
    return yield* Option.match(Option.fromUndefinedOr(text), {
      onNone: () => Effect.succeed(undefined),
      onSome: (content) =>
        Result.match(S.decodeUnknownResult(ManifestDocumentJson)(content), {
          onFailure: (cause) => Effect.fail(new WorkerManifestMalformed({ pluginName, file, cause })),
          onSuccess: (document) => Effect.succeed<Record<string, unknown> | undefined>(document),
        }),
    })
  })

interface FoundManifest {
  readonly directory: string
  readonly document: Record<string, unknown>
}

const manifestInDirectory = (
  directory: string,
  pluginName: string,
  ascentsRemaining: number,
): Effect.Effect<FoundManifest | undefined, WorkerManifestMalformed, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const document = yield* manifestDocumentAt(path.join(directory, PACKAGE_MANIFEST), pluginName)
    if (document !== undefined) {
      return { directory, document }
    }
    return yield* manifestAboveDirectory(directory, pluginName, ascentsRemaining)
  })

const manifestAboveDirectory = (
  directory: string,
  pluginName: string,
  ascentsRemaining: number,
): Effect.Effect<FoundManifest | undefined, WorkerManifestMalformed, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const parent = path.dirname(directory)
    const stopped = parent === directory || ascentsRemaining <= 0
    return yield* Match.value(stopped).pipe(
      Match.when(true, () => Effect.succeed<FoundManifest | undefined>(undefined)),
      Match.orElse(() => manifestInDirectory(parent, pluginName, ascentsRemaining - 1)),
    )
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
): Effect.Effect<FoundManifest, WorkerEntryMissing | WorkerManifestMalformed, FileSystem.FileSystem | Path.Path> =>
  manifestInDirectory(path.dirname(source.modulePath), source.name, MANIFEST_WALK_LIMIT).pipe(
    Effect.flatMap((manifest) =>
      Option.match(Option.fromUndefinedOr(manifest), {
        onNone: () => Effect.fail(missingEntry(source.name, source.modulePath)),
        onSome: (found) => Effect.succeed(found),
      })
    ),
  )

const entryField = (entry: WorkerEntryDecision): 'bin' | 'workerExport' =>
  Match.value(entry).pipe(
    Match.tag('WorkerEntryFromBin', (): 'bin' => 'bin'),
    Match.tag('WorkerEntryFromWorkerExport', (): 'workerExport' => 'workerExport'),
    Match.exhaustive,
  )

export const resolvePluginWorkerEntry = (params: {
  readonly loaded: Pick<LoadedPlugins, 'pluginSources'>
  readonly kind: WorkerPluginKind
  readonly name: string
}): Effect.Effect<
  WorkerPluginSpawn,
  WorkerEntryMissing | WorkerEntryOutsidePackage | WorkerManifestMalformed,
  FileSystem.FileSystem | Path.Path
> =>
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
    const entrypoint = path.resolve(manifest.directory, entry.relativeEntrypoint)
    const insidePackageRoot = entrypoint.startsWith(`${manifest.directory}${path.sep}`)
    return yield* Match.value(insidePackageRoot).pipe(
      Match.when(true, () =>
        Effect.succeed({
          kind: params.kind,
          field: entryField(entry),
          entrypoint,
        })),
      Match.orElse(() =>
        Effect.fail(
          new WorkerEntryOutsidePackage({
            pluginName: source.name,
            entrypoint,
            packageRoot: manifest.directory,
          }),
        )
      ),
    )
  })
