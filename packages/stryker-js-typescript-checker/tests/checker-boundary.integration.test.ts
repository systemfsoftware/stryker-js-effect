import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { And, Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Checker } from '@systemfsoftware/stryker-js-language'
import { Module } from '@systemfsoftware/stryker-js-language'
import { Mutant } from '@systemfsoftware/stryker-js-language'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-language'
import { RunConfiguration, SandboxDirectory } from '@systemfsoftware/stryker-js-plugin-interface'
import { strykerPlugins } from '@systemfsoftware/stryker-js-typescript-checker'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import { expect } from 'vitest'

const fixtureRoot = Effect.gen(function*() {
  const path = yield* Path.Path
  return yield* path.fromFileUrl(new URL('../testResources/single-project', import.meta.url))
}).pipe(Effect.orDie)

const Feature = makeFeature({ it, layer })

const nodeModuleLayer = Layer.effect(
  Module,
  Effect.sync(() => {
    const nodeModule: {
      createRequire(
        filename?: string | URL,
      ): {
        (request: string): unknown
        resolve(request: string, options?: { paths?: string[] }): string
      }
      isBuiltin(moduleName: string): boolean
    } = process.getBuiltinModule('node:module')
    return {
      createRequire: (filename: string | URL) => {
        const requireFn = nodeModule.createRequire(filename)
        return Object.assign((request: string) => requireFn(request), {
          resolve: (request: string, options?: { paths?: readonly string[] }) => {
            if (options === undefined) {
              return requireFn.resolve(request)
            }
            return requireFn.resolve(request, { paths: [...options.paths ?? []] })
          },
        })
      },
      isBuiltin: (moduleName: string) => nodeModule.isBuiltin(moduleName),
    }
  }),
)

const host = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  nodeModuleLayer,
  Layer.effect(SandboxDirectory, fixtureRoot).pipe(Layer.provide(NodePath.layer)),
)

const openChecker = Effect.gen(function*() {
  const plugin = strykerPlugins[0]
  if (plugin === undefined) {
    return yield* Effect.die(new Error('typescript checker plugin missing'))
  }
  const path = yield* Path.Path
  const root = yield* fixtureRoot
  const options = yield* S.decodeUnknownEffect(StrykerOptionsSchema)({
    tsconfigFile: path.join(root, 'tsconfig.json'),
  }).pipe(Effect.orDie)
  const env = Layer.mergeAll(host, Layer.succeed(RunConfiguration, options))
  const context = yield* Layer.build(plugin.layer.pipe(Layer.provide(env)))
  const sut = Context.get(context, Checker)
  yield* sut.init.pipe(Effect.orDie)
  return sut
})

const mutantAt = (fileName: string, line: number, column: number, id: string): Mutant =>
  new Mutant({
    id,
    fileName,
    mutatorName: 'foo-mutator',
    replacement: '-',
    location: {
      start: { line, column },
      end: { line, column: column + 1 },
    },
  })

Feature('Typechecking a mutant the program does not hold').withLayer(host).liveClock().body(({ scenario }) => {
  scenario(
    'A mutant in a file outside the program is reported passed while a held file still reports its error',
    Gherkin.Do.pipe(
      Given('the TypeScript checker is ready on the sample project')('sut', () => openChecker),
      When('a mutant in a file the tsconfig does not include and a type-breaking mutant in a held file are checked')(
        'actual',
        ({ sut }) =>
          Effect.gen(function*() {
            const path = yield* Path.Path
            const root = yield* fixtureRoot
            return yield* sut.check([
              mutantAt(path.join(root, 'src', 'not-type-checked.js'), 1, 0, 'outsideProgram'),
              mutantAt(path.join(root, 'src', 'todo.ts'), 12, 24, 'insideProgram'),
            ])
          }),
      ),
      Then('the mutant outside the program is answered passed')(({ actual }) =>
        Effect.sync(() => {
          expect(HashMap.get(actual, 'outsideProgram')).toEqual(Option.some({ status: 'passed' }))
        })
      ),
      And('the mutant inside the program is still compile-checked')(({ actual }) =>
        Effect.sync(() => {
          expect(Option.isSome(HashMap.get(actual, 'insideProgram'))).toBe(true)
        })
      ),
    ),
  )
})
