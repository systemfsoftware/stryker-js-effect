import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { strykerPlugins } from '@systemfsoftware/stryker-js-angular'
import { Framework, Module, StrykerOptionsSchema } from '@systemfsoftware/stryker-js-language'
import type { ModuleRequire, StrykerOptions } from '@systemfsoftware/stryker-js-language'
import { RunConfiguration, SandboxDirectory } from '@systemfsoftware/stryker-js-plugin-interface'
import type { PluginEnvironment } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

const PARSER_MANIFEST_SPECIFIER = 'angular-html-parser/package.json'

const PARSER_MANIFEST_URL = new URL(`../../node_modules/${PARSER_MANIFEST_SPECIFIER}`, import.meta.url)

const SANDBOX_DIRECTORY = '/tmp/angular-project'

const options: StrykerOptions = Effect.runSync(
  S.decodeEffect(StrykerOptionsSchema)({}).pipe(Effect.orDie),
)

const nodeFsPathLayer: Layer.Layer<FileSystem.FileSystem | Path.Path> = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
)

interface InstalledManifest {
  readonly file: string
  readonly manifest: unknown
}

const readInstalledManifest: Effect.Effect<InstalledManifest> = Effect.gen(function*() {
  const pathService = yield* Path.Path
  const file = yield* pathService.fromFileUrl(PARSER_MANIFEST_URL).pipe(Effect.orDie)
  const fileSystem = yield* FileSystem.FileSystem
  const text = yield* fileSystem.readFileString(file).pipe(Effect.orDie)
  const manifest = yield* S.decodeUnknownEffect(S.fromJsonString(S.Unknown))(text).pipe(Effect.orDie)
  return { file, manifest }
}).pipe(Effect.provide(nodeFsPathLayer))

export const installedParserVersion: Effect.Effect<string> = Effect.gen(function*() {
  const installed = yield* readInstalledManifest
  const decoded = yield* S.decodeUnknownEffect(S.Struct({ version: S.String }))(installed.manifest).pipe(
    Effect.orDie,
  )
  return decoded.version
})

const manifestRequire = (installed: InstalledManifest): ModuleRequire => {
  const requireOf = (request: string): unknown => {
    if (request !== PARSER_MANIFEST_SPECIFIER) {
      throw new Error(`the fixture answers only "${PARSER_MANIFEST_SPECIFIER}", not "${request}"`)
    }
    return installed.manifest
  }
  return Object.assign(requireOf, {
    resolve: (request: string): string => {
      if (request !== PARSER_MANIFEST_SPECIFIER) {
        throw new Error(`the fixture answers only "${PARSER_MANIFEST_SPECIFIER}", not "${request}"`)
      }
      return installed.file
    },
  })
}

const moduleLayer = (installed: InstalledManifest): Layer.Layer<Module> =>
  Layer.succeed(Module, {
    createRequire: (): ModuleRequire => manifestRequire(installed),
    isBuiltin: (): boolean => false,
  })

export const installedEnvironmentLayer: Effect.Effect<Layer.Layer<PluginEnvironment>> = Effect.map(
  readInstalledManifest,
  (installed) =>
    Layer.mergeAll(
      moduleLayer(installed),
      Layer.succeed(RunConfiguration, options),
      Layer.succeed(SandboxDirectory, SANDBOX_DIRECTORY),
      NodeFileSystem.layer,
      NodePath.layer,
    ),
)

const angularFormatLayer = Option.getOrThrowWith(
  Option.map(Option.fromNullishOr(strykerPlugins.at(0)), (plugin) => plugin.layer),
  () => new Error('@systemfsoftware/stryker-js-angular publishes no Framework contribution'),
)

export const angularService = (environment: Layer.Layer<PluginEnvironment>) =>
  Effect.scoped(Layer.build(angularFormatLayer.pipe(Layer.provide(environment)))).pipe(
    Effect.map((context) => Context.get(context, Framework)),
  )
