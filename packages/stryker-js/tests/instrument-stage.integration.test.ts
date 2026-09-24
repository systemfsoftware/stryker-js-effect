import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stdio from 'effect/Stdio'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const UNKNOWN_NAME = 'TurnItUpToEleven'

interface ProjectFixture {
  readonly root: string
}

const SOURCE_FILE = 'src/math.ts'
const SOURCE_CONTENT = 'export const add = (left: number, right: number): number => left + right\n'

const writeProject = (): Effect.Effect<ProjectFixture, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory()
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.writeFileString(path.join(root, SOURCE_FILE), SOURCE_CONTENT)
    return { root }
  })

const removeProject = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.remove(root, { recursive: true })),
  ))

const runFromProject = (
  root: string,
  options: Options.PartialStrykerOptions,
): Effect.Effect<
  Result.Result<Engine.MutationTestDone, Engine.StageError | PlatformError>,
  never,
  Engine.EnginePorts
> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(root)
      return previous
    }),
    () => Effect.result(Engine.strykerCell({ mutate: ['src/**/*.ts'], ...options })),
    (previous) =>
      Effect.sync(() => {
        globalThis.process.chdir(previous)
      }),
  )

const failureOf = (outcome: Result.Result<Engine.MutationTestDone, Engine.StageError | PlatformError>): Engine.StageError => {
  if (Result.isSuccess(outcome)) {
    throw new Error('the run was expected to be refused, but it completed')
  }
  if (!S.is(Engine.StageError)(outcome.failure)) {
    throw new Error(`the run was expected to be refused as a stage, not a platform failure: ${String(outcome.failure)}`)
  }
  return outcome.failure
}

const carriesMessage = (value: unknown): value is { readonly message: string } =>
  typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string'

const textOf = (cause: Engine.StageError['cause']): string =>
  carriesMessage(cause) ? cause.message : 'the refused cause carried no message'

const runLayer = Layer.mergeAll(Engine.nodePlatformLayer, Stdio.layerTest({}))

Feature('Opting a mutation run into extra mutations')
  .withLayer(runLayer)
  .body(({ scenario }) => {
    scenario(
      'A run asked for an extra mutation nobody provides refuses to start',
      Gherkin.Do.pipe(
        Given('a project with one small source file')('project', () => writeProject()),
        When('the run starts with a made-up name on its opt-in list')(
          'outcome',
          (s) =>
            runFromProject(s.project.root, { mutator: { optInMutations: [UNKNOWN_NAME] } }).pipe(
              Effect.ensuring(removeProject(s.project.root)),
            ),
        ),
        Then('the run stops before any mutant exists, blaming the unknown name')((s) => {
          const failure = failureOf(s.outcome)
          expect(failure.stage).toBe('instrument')
          expect(textOf(failure.cause)).toContain(`Unknown opt-in mutations: '${UNKNOWN_NAME}'`)
        }),
        Then('the refusal also names the extra mutations that do exist')((s) => {
          expect(textOf(failureOf(s.outcome).cause)).toContain('Known opt-in mutations:')
        }),
      ),
    )
  })
