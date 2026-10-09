import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, Mutant, Options, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { CheckerRuntime, checkerRuntimeLayer } from '@systemfsoftware/stryker-js-typescript-checker/runtime'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  AnnotationDangling,
  type AnnotationParseFailure,
  CompileErrorOutcome,
  matchAnnotations,
  MatchAnnotationsCommand,
  type MatchedAnnotation,
  MutantClaimedTwice,
  MutantUnmatched,
  NamedMutators,
  parseAnnotations,
  ParseAnnotationsCommand,
  placementClosure,
  PlacementClosureCommand,
  type SourcedAnnotation,
  type SourceLine,
} from '@systemfsoftware/stryker-e2e-core'
import type { PlacementSlice } from './__fixtures__/placement-slice.schema.js'
import type { SliceMutators } from './__fixtures__/slice-mutators.js'
import { type SliceFixture, sliceFixtures, type SliceSource } from './__fixtures__/slice-sources.js'

const Feature = makeFeature({ it })

const MARKER = /^\s*\/\/\s*@stryker-expect\b/

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const FILE_PORTS = Layer.mergeAll(
  FILE_AND_PATH,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)),
)

const fixtures = await Effect.runPromise(sliceFixtures.pipe(Effect.provide(FILE_PORTS)))

const sampleFixture = (): SliceFixture => {
  const found = fixtures.find((fixture) => fixture.slice.id === 'annotated-sample')
  if (found === undefined) {
    throw new Error('the placement slice list carries no "annotated-sample" entry')
  }
  return found
}

const linesOf = (content: string): ReadonlyArray<SourceLine> =>
  content.split('\n').map((text, index) => ({ number: index + 1, text }))

const annotationsOf = (file: SliceSource): Result.Result<ReadonlyArray<SourcedAnnotation>, AnnotationParseFailure> =>
  Result.map(
    parseAnnotations(ParseAnnotationsCommand.make({ file: file.name, lines: [...linesOf(file.content)] })),
    (annotations) => annotations.map((annotation): SourcedAnnotation => ({ file: file.name, annotation })),
  )

const fileOf = (file: SliceSource): Instrument.File => ({ name: file.name, content: file.content, mutate: true })

const instrumentOptionsOf = (mutators: SliceMutators, slice: PlacementSlice): Instrument.InstrumenterOptions => ({
  ignorers: [],
  excludedMutations: [...slice.excludedMutations],
  mutantSetPolicy: 'full',
  mutators: mutators.selection,
})

const instrumentedOf = (
  files: ReadonlyArray<SliceSource>,
  fixture: SliceFixture,
): Effect.Effect<ReadonlyArray<Mutant.Mutant>, Instrument.InstrumentError> =>
  Effect.map(
    Instrument.instrument(files.map(fileOf), instrumentOptionsOf(fixture.mutators, fixture.slice)),
    (result) => result.mutants,
  )

interface ReportMutant {
  readonly file: string
  readonly mutant: Report.MutantResult
}

const placedOf = (mutants: ReadonlyArray<Mutant.Mutant>): Effect.Effect<ReadonlyArray<ReportMutant>, S.SchemaError> =>
  Effect.forEach(mutants, (mutant) =>
    Effect.map(
      S.decodeEffect(Report.MutantResult)({
        id: mutant.id,
        location: mutant.location,
        mutatorName: mutant.mutatorName,
        replacement: mutant.replacement,
        status: mutant.status ?? 'Pending',
        ...(mutant.statusReason === undefined ? {} : { statusReason: mutant.statusReason }),
      }),
      (decoded): ReportMutant => ({ file: mutant.fileName, mutant: decoded }),
    ))

const annotationsOrFail = (
  files: ReadonlyArray<SliceSource>,
): Effect.Effect<ReadonlyArray<SourcedAnnotation>, AnnotationParseFailure> =>
  Effect.gen(function*() {
    const perFile = yield* Effect.forEach(files, (file) => Effect.fromResult(annotationsOf(file)))
    return perFile.flat()
  })

const MEMBERSHIP_CODES: ReadonlyArray<string> = ['TS6059', 'TS6307']

const reportedCodesOf = (reason: string): ReadonlyArray<string> =>
  [...reason.matchAll(/error (TS\d+):/g)].map((match) => match[1])

const checkerWiresOf = (
  fixture: SliceFixture,
  mutants: ReadonlyArray<Mutant.Mutant>,
): ReadonlyArray<Checker.CheckerMutantWire> => {
  const absolutePaths = HashMap.fromIterable(fixture.files.map((file) =>
    [
      Mutant.CanonicalFileName.make(file.name),
      Mutant.CanonicalFileName.make(file.absolutePath),
    ] as const
  ))
  return mutants.map((mutant) => ({
    id: mutant.id,
    fileName: Option.getOrThrow(HashMap.get(absolutePaths, mutant.fileName)),
    mutatorName: mutant.mutatorName,
    replacement: mutant.replacement,
    location: mutant.location,
  }))
}

const reasonOf = (result: Option.Option<Checker.CheckResult>): string =>
  Option.match(result, {
    onNone: () => '',
    onSome: (decoded) => (decoded.status === 'passed' ? '' : decoded.reason),
  })

const confirmationsOf = (
  fixture: SliceFixture,
  mutants: ReadonlyArray<Mutant.Mutant>,
): Effect.Effect<HashMap.HashMap<string, string>, Checker.CheckerFailed | S.SchemaError> =>
  Effect.gen(function*() {
    if (mutants.length === 0) {
      return HashMap.empty<string, string>()
    }
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({ tsconfigFile: fixture.checkerTsconfigFile })
    return yield* Effect.scoped(Effect.gen(function*() {
      const context = yield* Layer.build(checkerRuntimeLayer(options).pipe(Layer.provide(FILE_PORTS)))
      return yield* Effect.gen(function*() {
        const runtime = yield* CheckerRuntime
        const checker = yield* Effect.orDie(runtime.checker)
        const results = yield* checker.check([...checkerWiresOf(fixture, mutants)])
        return HashMap.fromIterable(
          mutants.map((mutant) => [mutant.id, reasonOf(HashMap.get(results, mutant.id))] as const),
        )
      }).pipe(Effect.provideContext(context))
    }))
  })

interface Placement {
  readonly fixture: SliceFixture
  readonly instrumented: ReadonlyArray<Mutant.Mutant>
  readonly mutants: ReadonlyArray<ReportMutant>
  readonly annotations: ReadonlyArray<SourcedAnnotation>
  readonly confirmations: HashMap.HashMap<string, string>
}

const compileErrorMutantsOf = (
  fixture: SliceFixture,
  instrumented: ReadonlyArray<Mutant.Mutant>,
  mutants: ReadonlyArray<ReportMutant>,
  annotations: ReadonlyArray<SourcedAnnotation>,
): ReadonlyArray<Mutant.Mutant> => {
  const matched = matchAnnotations(
    MatchAnnotationsCommand.make({
      slice: fixture.slice.id,
      annotations: [...annotations],
      mutants: [...mutants],
    }),
  )
  const pairs = Result.getOrElse(matched, (): ReadonlyArray<MatchedAnnotation> => [])
  const byId = HashMap.fromIterable(instrumented.map((mutant) => [mutant.id, mutant] as const))
  return pairs
    .filter((pair) => S.is(CompileErrorOutcome)(pair.annotation.annotation.outcome))
    .flatMap((pair) =>
      Option.match(HashMap.get(byId, Mutant.MutantId.make(pair.mutant.mutant.id)), {
        onNone: (): ReadonlyArray<Mutant.Mutant> => [],
        onSome: (mutant): ReadonlyArray<Mutant.Mutant> => [mutant],
      })
    )
}

const placementOf = (
  fixture: SliceFixture,
): Effect.Effect<
  Placement,
  Instrument.InstrumentError | S.SchemaError | AnnotationParseFailure | Checker.CheckerFailed
> =>
  Effect.gen(function*() {
    const instrumented = yield* instrumentedOf(fixture.files, fixture)
    const mutants = yield* placedOf(instrumented)
    const annotations = yield* annotationsOrFail(fixture.files)
    const confirmations = yield* confirmationsOf(
      fixture,
      compileErrorMutantsOf(fixture, instrumented, mutants, annotations),
    )
    return { fixture, instrumented, mutants, annotations, confirmations }
  })

interface ObservationOverrides {
  readonly omitAnnotation?: number
  readonly omitMutant?: number
  readonly authoredCode?: (authored: string) => string
}

interface PlacementObservation {
  readonly mutantCount: number
  readonly matchedCount: number
  readonly unmatched: ReadonlyArray<string>
  readonly dangling: ReadonlyArray<string>
  readonly claimedTwice: ReadonlyArray<string>
  readonly unwitnessed: ReadonlyArray<string>
  readonly closureRefusals: ReadonlyArray<string>
  readonly compileErrorFindings: ReadonlyArray<string>
  readonly outsideOwningProject: ReadonlyArray<string>
}

interface ConfirmationFindings {
  readonly compileErrorFindings: ReadonlyArray<string>
  readonly outsideOwningProject: ReadonlyArray<string>
}

const confirmationFindingsOf = (input: {
  readonly placement: Placement
  readonly matched: ReadonlyArray<MatchedAnnotation>
  readonly authoredCode: (authored: string) => string
}): ConfirmationFindings => {
  const compileErrorFindings: string[] = []
  const outsideOwningProject: string[] = []
  for (const pair of input.matched) {
    const outcome = pair.annotation.annotation.outcome
    if (!S.is(CompileErrorOutcome)(outcome)) {
      continue
    }
    const authored = input.authoredCode(outcome.code)
    const at = pair.mutant.mutant.location.start
    const reported = reportedCodesOf(
      Option.getOrElse(HashMap.get(input.placement.confirmations, pair.mutant.mutant.id), () => ''),
    )
    const membership = reported.filter((code) => MEMBERSHIP_CODES.includes(code))
    if (membership.length > 0) {
      outsideOwningProject.push(
        `${pair.mutant.file}:${at.line}:${at.column}: the ${pair.mutant.mutant.mutatorName} mutant was confirmed ` +
          `outside the project "${input.placement.fixture.checkerTsconfigFile}": ${membership.join(', ')}`,
      )
    }
    if (reported.includes(authored)) {
      continue
    }
    compileErrorFindings.push(
      `${pair.mutant.file}:${at.line}:${at.column}: the ${pair.mutant.mutant.mutatorName} mutant is annotated ` +
        `CompileError(${authored}) but the compiler reported ${
          reported.length === 0 ? 'no diagnostic code' : reported.join(', ')
        }`,
    )
  }
  return { compileErrorFindings, outsideOwningProject }
}

const observationOf = (placement: Placement, overrides: ObservationOverrides = {}): PlacementObservation => {
  const annotations = placement.annotations.filter((_sourced, index) => index !== overrides.omitAnnotation)
  const mutants = placement.mutants.filter((_mutant, index) => index !== overrides.omitMutant)
  const matched = matchAnnotations(
    MatchAnnotationsCommand.make({
      slice: placement.fixture.slice.id,
      annotations: [...annotations],
      mutants: [...mutants],
    }),
  )
  const pairs = Result.getOrElse(matched, (): ReadonlyArray<MatchedAnnotation> => [])
  const failures = Result.isFailure(matched) ? [matched.failure] : []
  const matchedNames = pairs.map((pair) => pair.mutant.mutant.mutatorName)
  const witnessed = Array.dedupe(placement.instrumented.map((mutant) => mutant.mutatorName))
    .filter((name) => matchedNames.includes(name))
  const closure = placementClosure(
    PlacementClosureCommand.make({
      entries: [...placement.fixture.mutators.entries],
      witnessed,
      waivers: [...placement.fixture.slice.waivers],
    }),
  )
  return {
    mutantCount: mutants.length,
    matchedCount: pairs.length,
    unmatched: failures.filter(S.is(MutantUnmatched)).map((failure) => failure.message),
    dangling: failures.filter(S.is(AnnotationDangling)).map((failure) => failure.message),
    claimedTwice: failures.filter(S.is(MutantClaimedTwice)).map((failure) => failure.message),
    unwitnessed: placement.fixture.mutators.entries
      .filter((entry) => !witnessed.includes(entry.name))
      .map((entry) => `${entry.tier} ${entry.name}`),
    closureRefusals: Result.isFailure(closure) ? [closure.failure.message] : [],
    ...confirmationFindingsOf({
      placement,
      matched: pairs,
      authoredCode: overrides.authoredCode ?? ((authored) => authored),
    }),
  }
}

const mutantTuplesOf = (mutants: ReadonlyArray<Mutant.Mutant>): ReadonlyArray<string> =>
  mutants
    .map((mutant) =>
      `${mutant.fileName}|${mutant.mutatorName}|${JSON.stringify(mutant.location)}|${mutant.replacement}`
    )
    .sort()

const withoutAnnotations = (files: ReadonlyArray<SliceSource>): ReadonlyArray<SliceSource> =>
  files.map((file) => ({
    ...file,
    content: file.content.split('\n').map((line) => (MARKER.test(line) ? '' : line)).join('\n'),
  }))

Feature('The in-process placement check', { timeout: 600_000 })
  .withLayer(FILE_PORTS)
  .live('the check reads and instruments the fixture files with the real oxc instrumenter')
  .body(({ scenario }) => {
    scenario(
      'Every mutant of the annotated sample is claimed by exactly one annotation',
      Gherkin.Do.pipe(
        Given('the placement slice list is instrumented in-process')(
          'placements',
          () => Effect.forEach(fixtures, (fixture) => placementOf(fixture)),
        ),
        Then('each slice claims every mutant it places, with every authored diagnostic code confirmed')(
          (s, expect) =>
            expect(s.placements.map((placement) => {
              const observation = observationOf(placement)
              return {
                matchedEveryMutant: observation.mutantCount > 0 &&
                  observation.matchedCount === observation.mutantCount,
                unmatched: observation.unmatched,
                dangling: observation.dangling,
                claimedTwice: observation.claimedTwice,
                compileErrorFindings: observation.compileErrorFindings,
              }
            })).toStrictEqual(
              fixtures.map(() => ({
                matchedEveryMutant: true,
                unmatched: [],
                dangling: [],
                claimedTwice: [],
                compileErrorFindings: [],
              })),
            ),
        ),
      ),
    )

    scenario(
      'A CompileError annotation is confirmed through the project the slice configures',
      Gherkin.Do.pipe(
        Given('the placement slice list is instrumented in-process')(
          'placements',
          () => Effect.forEach(fixtures, (fixture) => placementOf(fixture)),
        ),
        Then('no confirmation reports a project-membership diagnostic')(
          (s, expect) =>
            expect(s.placements.map((placement) => ({
              slice: placement.fixture.slice.id,
              outsideOwningProject: observationOf(placement).outsideOwningProject,
            }))).toStrictEqual(
              fixtures.map((fixture) => ({ slice: fixture.slice.id, outsideOwningProject: [] })),
            ),
        ),
      ),
    )

    scenario(
      'Placement closure holds over the stock catalog, the opt-in tier and the sample provider',
      Gherkin.Do.pipe(
        Given('the annotated sample slice is instrumented in-process')('placement', () => placementOf(sampleFixture())),
        Then('no catalog entry is unwitnessed and no closure refusal is raised')((s, expect) => {
          const observation = observationOf(s.placement)
          return expect({
            unwitnessed: observation.unwitnessed,
            closureRefusals: observation.closureRefusals,
            tiers: [...new Set(s.placement.fixture.mutators.entries.map((entry) => entry.tier))].sort(),
            providerEntryWitnessed: observation.matchedCount === observation.mutantCount &&
              s.placement.fixture.mutators.entries.some((entry) => entry.name === 'acme/FlipSide'),
          }).toStrictEqual({
            unwitnessed: [],
            closureRefusals: [],
            tiers: ['default', 'optIn'],
            providerEntryWitnessed: true,
          })
        }),
      ),
    )

    scenario(
      'A mutant with no annotation fails naming its file, its location and its mutator',
      Gherkin.Do.pipe(
        Given('the annotated sample slice is instrumented in-process')('placement', () => placementOf(sampleFixture())),
        When('one of its annotations is dropped from the fixture')('observed', (s) => {
          const dropped = s.placement.annotations.findIndex((sourced) =>
            S.is(NamedMutators)(sourced.annotation.mutators) &&
            sourced.annotation.mutators.items.some((item) => item.name === 'ArithmeticOperator')
          )
          const observation = observationOf(s.placement, { omitAnnotation: dropped })
          return Effect.succeed({ dropped, observation })
        }),
        Then('the gate fails and names the file, the location and the mutator')((s, expect) =>
          expect({
            droppedAnAnnotation: s.observed.dropped >= 0,
            unmatchedCount: s.observed.observation.unmatched.length,
            namesFileLocationAndMutator: s.observed.observation.unmatched.some((message) =>
              message.includes('arithmetic.ts') && /:\d+:\d+:/.test(message) &&
              message.includes('ArithmeticOperator')
            ),
          }).toStrictEqual({ droppedAnAnnotation: true, unmatchedCount: 1, namesFileLocationAndMutator: true })
        ),
      ),
    )

    scenario(
      'An annotation whose mutant is gone is dangling and names the annotation',
      Gherkin.Do.pipe(
        Given('the annotated sample slice is instrumented in-process')('placement', () => placementOf(sampleFixture())),
        When('a mutant it claims is removed from the instrumented set')('observed', (s) => {
          const dropped = s.placement.mutants.findIndex((entry) => entry.mutant.mutatorName === 'UpdateOperator')
          const observation = observationOf(s.placement, { omitMutant: dropped })
          return Effect.succeed({ dropped, observation })
        }),
        Then('the gate fails as dangling and names the annotation')((s, expect) =>
          expect({
            droppedAMutant: s.observed.dropped >= 0,
            danglingCount: s.observed.observation.dangling.length,
            namesTheAnnotation: s.observed.observation.dangling.some((message) =>
              message.includes('arithmetic.ts') && message.includes('claims no mutant')
            ),
          }).toStrictEqual({ droppedAMutant: true, danglingCount: 1, namesTheAnnotation: true })
        ),
      ),
    )

    scenario(
      'A CompileError code the compiler does not report fails and names both codes',
      Gherkin.Do.pipe(
        Given('the annotated sample slice is instrumented in-process')('placement', () => placementOf(sampleFixture())),
        When('its authored CompileError code is replaced by one the compiler never reports')('observed', (s) => {
          const accepted = observationOf(s.placement)
          const mismatched = observationOf(s.placement, { authoredCode: () => 'TS9999' })
          return Effect.succeed({ accepted, mismatched })
        }),
        Then('the authored code is confirmed when it matches and both codes are named when it does not')(
          (s, expect) =>
            expect({
              authoredCodeAccepted: s.observed.accepted.compileErrorFindings,
              mismatchedCode: s.observed.mismatched.compileErrorFindings.map((finding) => ({
                namesAuthoredCode: finding.includes('TS9999'),
                namesReportedCode: finding.includes('TS2741'),
                namesMutant: finding.includes('ObjectLiteral'),
              })),
            }).toStrictEqual({
              authoredCodeAccepted: [],
              mismatchedCode: [{ namesAuthoredCode: true, namesReportedCode: true, namesMutant: true }],
            }),
        ),
      ),
    )

    scenario(
      'Instrumenting a fixture with its annotations removed yields the same mutants',
      Gherkin.Do.pipe(
        Given('the annotated sample slice is instrumented in-process')('placement', () => placementOf(sampleFixture())),
        When('the same slice is instrumented with every annotation line blanked')('runs', (s) =>
          Effect.map(
            instrumentedOf(withoutAnnotations(s.placement.fixture.files), s.placement.fixture),
            (without) => ({ withAnnotations: s.placement.instrumented, without }),
          )),
        Then('both instrumentations place the same mutants at the same locations')((s, expect) =>
          expect({
            instrumentsSomething: s.runs.withAnnotations.length > 0,
            sameMutants: JSON.stringify(mutantTuplesOf(s.runs.withAnnotations)) ===
              JSON.stringify(mutantTuplesOf(s.runs.without)),
          }).toStrictEqual({ instrumentsSomething: true, sameMutants: true })
        ),
      ),
    )
  })
