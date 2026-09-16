import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { resolvePluginWorkerEntry } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import type {
  WorkerEntryMissing,
  WorkerEntryOutsidePackage,
  WorkerManifestMalformed,
} from '@systemfsoftware/stryker-js-engine/plugin-loader'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as PlatformError from 'effect/PlatformError'
import * as Result from 'effect/Result'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const PACKAGE_ROOT = '/project/node_modules/@acme/stryker-runner'
const MANIFEST = `${PACKAGE_ROOT}/package.json`
const MODULE_PATH = `${PACKAGE_ROOT}/dist/index.mjs`
const NAME = '@acme/stryker-runner'

type Files = Readonly<Record<string, string>>

type WorkerEntryFailure = WorkerEntryMissing | WorkerEntryOutsidePackage | WorkerManifestMalformed

type Resolution = Result.Result<
  { readonly kind: string; readonly field: string; readonly entrypoint: string },
  WorkerEntryFailure
>

const manifestOf = (fields: Record<string, unknown>): string => JSON.stringify({ name: NAME, ...fields })

const installed = (fields: Record<string, unknown>, modulePath: string = MODULE_PATH): Files => ({
  [MANIFEST]: manifestOf(fields),
  [modulePath]: '',
})

const notFound = (file: string): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: 'NotFound',
    module: 'FileSystem',
    method: 'readFileString',
    pathOrDescriptor: file,
  })

const fileSystemLayer = (files: Files): Layer.Layer<FileSystem.FileSystem> =>
  FileSystem.layerNoop({
    readFileString: (file) =>
      Option.match(Option.fromUndefinedOr(files[file]), {
        onNone: () => Effect.fail(notFound(file)),
        onSome: (content) => Effect.succeed(content),
      }),
  })

const resolve = (files: Files, modulePath: string): Effect.Effect<Resolution> =>
  resolvePluginWorkerEntry({
    loaded: { pluginSources: [{ kind: 'TestRunner', name: 'vitest', modulePath }] },
    kind: 'TestRunner',
    name: 'vitest',
  }).pipe(
    Effect.provide(Layer.mergeAll(fileSystemLayer(files), Path.layer)),
    Effect.result,
    Effect.map((result): Resolution => result),
  )

const resolvedOrThrow = (resolution: Resolution) => {
  if (Result.isFailure(resolution)) {
    throw new Error(`the worker entry was expected to resolve, but it was refused: ${String(resolution.failure)}`)
  }
  return resolution.success
}

const refusalOrThrow = (resolution: Resolution): Record<string, unknown> => {
  if (Result.isSuccess(resolution)) {
    throw new Error(`the worker entry was expected to be refused, but it resolved to ${resolution.success.entrypoint}`)
  }
  const failure: object = resolution.failure
  return { ...failure }
}

const deepModule = (directories: number): string =>
  `${PACKAGE_ROOT}/${
    Array.from({ length: directories }, (_, index) => String.fromCharCode(97 + index)).join('/')
  }/index.mjs`

Feature('Locating the worker entry a plugin declares').body(({ scenario }) => {
  scenario(
    'A plugin that declares its worker as a subpath resolves the path that subpath names',
    Gherkin.Do.pipe(
      Given('a project whose installed package declares its worker under the node condition')(
        'files',
        () => Effect.succeed(installed({ exports: { './worker': { node: './dist/worker.node.mjs' } } })),
      ),
      When('the worker entry is resolved')('resolution', (s) => resolve(s.files, MODULE_PATH)),
      Then('the entry is the path the node condition names')((s) => {
        expect(resolvedOrThrow(s.resolution)).toStrictEqual({
          kind: 'TestRunner',
          field: 'workerExport',
          entrypoint: `${PACKAGE_ROOT}/dist/worker.node.mjs`,
        })
      }),
    ),
  )

  scenario(
    'A plugin whose worker subpath offers only a default resolves that path',
    Gherkin.Do.pipe(
      Given('a project whose installed package declares its worker only under the default condition')(
        'files',
        () => Effect.succeed(installed({ exports: { './worker': { default: './dist/worker.default.mjs' } } })),
      ),
      When('the worker entry is resolved')('resolution', (s) => resolve(s.files, MODULE_PATH)),
      Then('the entry is the path the default condition names')((s) => {
        expect(resolvedOrThrow(s.resolution).entrypoint).toBe(`${PACKAGE_ROOT}/dist/worker.default.mjs`)
      }),
    ),
  )

  scenario(
    'A package that ships several commands resolves the one it is named for',
    Gherkin.Do.pipe(
      Given('a project whose installed package ships a command per binary and is named for one of them')(
        'files',
        () =>
          Effect.succeed(
            installed({ bin: { 'other-tool': './dist/other.mjs', [NAME]: './dist/worker.mjs' } }),
          ),
      ),
      When('the worker entry is resolved')('resolution', (s) => resolve(s.files, MODULE_PATH)),
      Then('the entry is the command the package is named for')((s) => {
        expect(resolvedOrThrow(s.resolution)).toStrictEqual({
          kind: 'TestRunner',
          field: 'bin',
          entrypoint: `${PACKAGE_ROOT}/dist/worker.mjs`,
        })
      }),
    ),
  )

  scenario(
    'A package that ships several commands and is named for none of them resolves the first',
    Gherkin.Do.pipe(
      Given('a project whose installed package ships two commands and matches neither name')(
        'files',
        () =>
          Effect.succeed(installed({ bin: { 'first-tool': './dist/first.mjs', 'second-tool': './dist/second.mjs' } })),
      ),
      When('the worker entry is resolved')('resolution', (s) => resolve(s.files, MODULE_PATH)),
      Then('the entry is the first command the package declares')((s) => {
        expect(resolvedOrThrow(s.resolution).entrypoint).toBe(`${PACKAGE_ROOT}/dist/first.mjs`)
      }),
    ),
  )

  scenario(
    'A plugin that declares both a worker subpath and a command runs the subpath',
    Gherkin.Do.pipe(
      Given('a project whose installed package declares a worker subpath and a command of its own')(
        'files',
        () =>
          Effect.succeed(
            installed({ exports: { './worker': './dist/worker.mjs' }, bin: { 'acme-cli': './dist/cli.mjs' } }),
          ),
      ),
      When('the worker entry is resolved')('resolution', (s) => resolve(s.files, MODULE_PATH)),
      Then('the entry is the declared worker subpath, not the command')((s) => {
        expect(resolvedOrThrow(s.resolution)).toStrictEqual({
          kind: 'TestRunner',
          field: 'workerExport',
          entrypoint: `${PACKAGE_ROOT}/dist/worker.mjs`,
        })
      }),
    ),
  )

  scenario(
    'A worker entry that points outside the package it belongs to is refused',
    Gherkin.Do.pipe(
      Given('a project whose installed package points its worker at a file outside itself')(
        'files',
        () => Effect.succeed(installed({ exports: { './worker': '../outside/evil.js' } })),
      ),
      When('the worker entry is resolved')('resolution', (s) => resolve(s.files, MODULE_PATH)),
      Then('the entry is refused, naming the plugin, the entry and the package root')((s) => {
        expect(refusalOrThrow(s.resolution)).toStrictEqual({
          _tag: 'WorkerEntryOutsidePackage',
          pluginName: 'vitest',
          entrypoint: '/project/node_modules/@acme/outside/evil.js',
          packageRoot: PACKAGE_ROOT,
        })
      }),
    ),
  )

  scenario(
    'A package manifest that cannot be read as JSON is refused, naming the file',
    Gherkin.Do.pipe(
      Given('a project whose installed package carries an unreadable manifest')(
        'files',
        () => Effect.succeed({ [MANIFEST]: '{ "name": "@acme/stryker-runner", }' }),
      ),
      When('the worker entry is resolved')('resolution', (s) => resolve(s.files, MODULE_PATH)),
      Then('the entry is refused, naming the plugin and the manifest file')((s) => {
        expect(refusalOrThrow(s.resolution)['_tag']).toBe('WorkerManifestMalformed')
        expect(refusalOrThrow(s.resolution)['pluginName']).toBe('vitest')
        expect(refusalOrThrow(s.resolution)['file']).toBe(MANIFEST)
      }),
    ),
  )

  scenario(
    'A manifest lying exactly at the search budget is found',
    Gherkin.Do.pipe(
      Given('a project whose entry sits ten directories inside its package')(
        'plan',
        () =>
          Effect.succeed({
            files: installed({ exports: { './worker': './dist/worker.mjs' } }, deepModule(10)),
            depth: 10,
          }),
      ),
      When('the worker entry is resolved')('resolution', (s) => resolve(s.plan.files, deepModule(s.plan.depth))),
      Then('the entry resolves against the manifest at the package root')((s) => {
        expect(resolvedOrThrow(s.resolution).entrypoint).toBe(`${PACKAGE_ROOT}/dist/worker.mjs`)
      }),
    ),
  )

  scenario(
    'A manifest lying beyond the search budget is treated as absent',
    Gherkin.Do.pipe(
      Given('a project whose entry sits eleven directories inside its package')(
        'plan',
        () =>
          Effect.succeed({
            files: installed({ exports: { './worker': './dist/worker.mjs' } }, deepModule(11)),
            depth: 11,
          }),
      ),
      When('the worker entry is resolved')('resolution', (s) => resolve(s.plan.files, deepModule(s.plan.depth))),
      Then('the entry is refused as undeclared rather than searched for indefinitely')((s) => {
        expect(refusalOrThrow(s.resolution)['_tag']).toBe('WorkerEntryMissing')
        expect(refusalOrThrow(s.resolution)['pluginName']).toBe('vitest')
      }),
    ),
  )
})
