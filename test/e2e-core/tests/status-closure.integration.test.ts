import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type JourneyAvailability,
  type StatusClosure,
  statusClosure,
  StatusClosureCommand,
  type StatusClosureFailure,
  StatusJourneyUnusable,
  WitnessRegistry,
  witnessRegistry,
} from '@systemfsoftware/stryker-e2e-core'

const Feature = makeFeature({ it })

const FILE_PORTS = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const REPOSITORY_ROOT_URL = new URL('../../../', import.meta.url)

const COMPILE_ERROR_JOURNEY = 'test/e2e/tests/enterprise-composite-checker.e2e.test.ts'

const SKIP_MARKER = /\.(skip|only|todo)\b/

const distinct = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  values.filter((value, index, all) => all.indexOf(value) === index)

const availabilityOf = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  journey: string,
): Effect.Effect<JourneyAvailability> =>
  Effect.map(
    fs.readFileString(path.join(root, journey)).pipe(Effect.option),
    (content) => ({
      path: journey,
      usable: Option.match(content, {
        onNone: () => false,
        onSome: (text) => !SKIP_MARKER.test(text),
      }),
    }),
  )

interface Manifest {
  readonly registry: WitnessRegistry
  readonly journeys: ReadonlyArray<JourneyAvailability>
}

const manifestOf = (): Effect.Effect<Manifest, S.SchemaError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* path.fromFileUrl(REPOSITORY_ROOT_URL).pipe(Effect.orDie)
    const registry = yield* S.decodeEffect(WitnessRegistry)(witnessRegistry)
    const journeys = yield* Effect.forEach(
      distinct(registry.witnesses.map((witness) => witness.journey)),
      (journey) => availabilityOf(fs, path, root, journey),
    )
    return { registry, journeys: [...journeys] }
  })

const closureOf = (manifest: Manifest): Result.Result<StatusClosure, StatusClosureFailure> =>
  statusClosure(StatusClosureCommand.make({
    statuses: [...Mutant.MutantStatusSchema.literals],
    registry: manifest.registry,
    journeys: [...manifest.journeys],
  }))

const refusalMessageOf = (closure: Result.Result<StatusClosure, StatusClosureFailure>): string | null =>
  Result.isFailure(closure) ? closure.failure.message : null

const witnessedStatusesOf = (closure: Result.Result<StatusClosure, StatusClosureFailure>): ReadonlyArray<string> =>
  Result.match(closure, {
    onFailure: (): ReadonlyArray<string> => [],
    onSuccess: (value) => value.witnesses.map((witness) => witness.status),
  })

const unusableJourneyOf = (
  closure: Result.Result<StatusClosure, StatusClosureFailure>,
): { readonly status: string; readonly journey: string } | null =>
  Result.isFailure(closure) && S.is(StatusJourneyUnusable)(closure.failure)
    ? { status: closure.failure.status, journey: closure.failure.journey }
    : null

const compileErrorJourneyOf = (registry: WitnessRegistry): string =>
  Option.getOrElse(
    Option.map(
      Option.fromUndefinedOr(registry.witnesses.find((witness) => witness.status === 'CompileError')),
      (witness) => witness.journey,
    ),
    () => '',
  )

Feature('The authored status witness registry')
  .withLayer(FILE_PORTS)
  .live('the closure decodes the authored registry and reads the lane journey files from the repository')
  .body(({ scenario }) => {
    scenario(
      'Every status the product ships has one usable witness journey and no waiver',
      Gherkin.Do.pipe(
        Given('the authored witness registry and the lane journey files')('manifest', () => manifestOf()),
        Then('status closure passes with every contract status witnessed')((s, expect) => {
          const closure = closureOf(s.manifest)
          return expect({
            refusal: refusalMessageOf(closure),
            everyJourneyUsable: s.manifest.journeys.every((journey) => journey.usable),
            witnessedStatuses: [...witnessedStatusesOf(closure)].sort(),
            waivedStatuses: s.manifest.registry.waivers.map((waiver) => waiver.status).sort(),
          }).toStrictEqual({
            refusal: null,
            everyJourneyUsable: true,
            witnessedStatuses: [...Mutant.MutantStatusSchema.literals].sort(),
            waivedStatuses: [],
          })
        }),
      ),
    )

    scenario(
      'A witness journey the lane cannot run refuses the closure naming the journey',
      Gherkin.Do.pipe(
        Given('the authored witness registry and the lane journey files')('manifest', () => manifestOf()),
        When('the journey the registry names for CompileError is marked unusable')('refused', (s) => {
          const named = compileErrorJourneyOf(s.manifest.registry)
          const journeys = s.manifest.journeys.map((journey) =>
            journey.path === named ? { path: journey.path, usable: false } : journey
          )
          return Effect.succeed({ named, closure: closureOf({ ...s.manifest, journeys }) })
        }),
        Then('the closure names the unusable CompileError journey')((s, expect) =>
          expect({
            namedByTheRegistry: s.refused.named,
            unusable: unusableJourneyOf(s.refused.closure),
          }).toStrictEqual({
            namedByTheRegistry: COMPILE_ERROR_JOURNEY,
            unusable: { status: 'CompileError', journey: COMPILE_ERROR_JOURNEY },
          })
        ),
      ),
    )
  })
