/**
 * Evaluator plugin wiring: listing the plugin is enough. A failing
 * contribution verdict returns the `VerdictFail` exit class on the SUCCESS channel;
 * EvaluatorFailed is only for the evaluator itself breaking.
 *
 * Warrant: composition — real gate decision through the Evaluator port's
 * Layer, not a mock; property tests cover the pure decision, this covers the
 * shell wiring (options through the layer factory, success value vs error channel).
 * Refusal: not a tautology — removing the system under test (the evaluator's
 * evaluate) would make the Then assertions fail (no VerdictFail where expected,
 * or no EvaluatorFailed where breaking expected).
 */
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Evaluator, Options, type Plugin, type Report, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { strykerPlugins, TestContributionEvaluator } from '@systemfsoftware/stryker-test-contribution'
import * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { optionalRunnerFields } from './__fixtures__/optional-runner-fields.js'

const Feature = makeFeature({ it })

const LOCATION = { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } }

const kernelMutant = (id: Mutant.MutantId, killedBy?: string[], coveredBy?: string[]): Report.MutantResult => ({
  id,
  status: 'Killed',
  mutatorName: 'BooleanLiteral',
  location: LOCATION,
  ...optionalRunnerFields(killedBy, coveredBy),
})

const reportWithToothlessKernelFile = (
  mutants: Report.MutantResult[] = [kernelMutant(Mutant.MutantId.make('1'), ['t1'], ['t1', 't2'])],
): Report.MutationTestResult => ({
  schemaVersion: '2',
  thresholds: { high: 80, low: 60, break: null },
  files: {
    'src/subject.ts': {
      language: 'typescript',
      source: 'export const a = 1\n',
      mutants,
    },
  },
  testFiles: {
    'earns.kernel.property.test.ts': { tests: [{ id: TestRunner.TestId.make('t1'), name: 'test t1' }] },
    'idle.kernel.property.test.ts': { tests: [{ id: TestRunner.TestId.make('t2'), name: 'test t2' }] },
  },
})

const evaluatorServiceWith = (options: Options.PartialStrykerOptions) =>
  Effect.map(
    Schema.decodeUnknownEffect(Options.StrykerOptionsSchema)(options),
    TestContributionEvaluator.makeTestContributionEvaluatorService,
  )

const evaluatorViaLayerWith = (options: Options.PartialStrykerOptions) =>
  Effect.gen(function*() {
    const decoded = yield* Schema.decodeUnknownEffect(Options.StrykerOptionsSchema)(options)
    const context = yield* Layer.build(TestContributionEvaluator.testContributionEvaluatorLayer(decoded))
    return Context.get(context, Evaluator.Evaluator)
  })
interface EvaluatorServiceShape {
  readonly evaluate: (
    report: Report.MutationTestResult,
  ) => Effect.Effect<Plugin.ExitClass | null, Evaluator.EvaluatorFailed>
}

const causeStringOf = <E = unknown>(cause: E): string | null => {
  if (cause === null || cause === undefined) return null
  if (typeof cause === 'string') return cause
  return JSON.stringify(cause)
}

const exitOf = (evaluator: EvaluatorServiceShape, report: Report.MutationTestResult) =>
  Effect.exit(evaluator.evaluate(report))

const causeOfExit = (exit: Exit.Exit<Plugin.ExitClass | null, Evaluator.EvaluatorFailed>): string | null => {
  if (Exit.isSuccess(exit)) return null
  const errorOption = Exit.findErrorOption(exit)
  if (Option.isSome(errorOption)) {
    const err = errorOption.value
    return causeStringOf(err.cause)
  }
  return Cause.pretty(exit.cause)
}
const verdictOfExit = (exit: Exit.Exit<Plugin.ExitClass | null, Evaluator.EvaluatorFailed>) => ({
  success: Exit.isSuccess(exit),
  value: Exit.isSuccess(exit) ? exit.value : undefined,
})
const failedWithCause = (exit: Exit.Exit<Plugin.ExitClass | null, Evaluator.EvaluatorFailed>) => ({
  failed: Exit.isFailure(exit),
  hasCause: causeOfExit(exit) !== null,
})

Feature('test-contribution evaluator plugin')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'The published plugin list declares one evaluator named test-contribution',
      Gherkin.Do.pipe(
        Given('the published plugin list')('plugins', () => Effect.succeed(strykerPlugins)),
        Then('it contains one Evaluator named test-contribution')((s, expect) =>
          expect({
            length: s.plugins.length,
            kind: s.plugins[0]?.kind,
            name: s.plugins[0]?.name,
          }).toEqual({ length: 1, kind: 'Evaluator', name: 'test-contribution' })
        ),
      ),
    )

    scenario(
      'A toothless required file yields a failing verdict',
      Gherkin.Do.pipe(
        Given('an evaluator service with disableBail true')(
          'evaluator',
          () => evaluatorServiceWith({ disableBail: true }),
        ),
        When('a report with one toothless kernel property file is evaluated')(
          'exit',
          (s) => exitOf(s.evaluator, reportWithToothlessKernelFile()),
        ),
        Then('the evaluation succeeds with the VerdictFail exit class')((s, expect) =>
          expect(verdictOfExit(s.exit)).toEqual({ success: true, value: 'VerdictFail' })
        ),
      ),
    )

    scenario(
      'Bail stopping killer recording still yields a failing verdict',
      Gherkin.Do.pipe(
        Given('an evaluator service with bail active (disableBail unset)')(
          'evaluator',
          () => evaluatorServiceWith({}),
        ),
        When('a report with one toothless kernel property file is evaluated')(
          'exit',
          (s) => exitOf(s.evaluator, reportWithToothlessKernelFile()),
        ),
        Then('the evaluation succeeds with the VerdictFail exit class for the bail case')((s, expect) =>
          expect(verdictOfExit(s.exit)).toEqual({ success: true, value: 'VerdictFail' })
        ),
      ),
    )

    scenario(
      'Every required file defending a mutant yields no verdict',
      Gherkin.Do.pipe(
        Given('an evaluator service with disableBail true')(
          'evaluator',
          () => evaluatorServiceWith({ disableBail: true }),
        ),
        When('a report where every kernel file kills a distinct mutant is evaluated')(
          'exit',
          (s) =>
            exitOf(
              s.evaluator,
              reportWithToothlessKernelFile([
                kernelMutant(Mutant.MutantId.make('1'), ['t1']),
                kernelMutant(Mutant.MutantId.make('2'), ['t2']),
              ]),
            ),
        ),
        Then('the evaluation succeeds with null')((s, expect) =>
          expect(verdictOfExit(s.exit)).toEqual({ success: true, value: null })
        ),
      ),
    )

    scenario(
      'The layer-provided evaluator fails on a toothless file',
      Gherkin.Do.pipe(
        Given('test-contribution options with disableBail true')(
          'options',
          () => Effect.succeed({ disableBail: true }),
        ),
        When('the evaluator layer is built with that configuration')('exit', (s) =>
          Effect.gen(function*() {
            const evaluator = yield* evaluatorViaLayerWith(s.options)
            return yield* exitOf(evaluator, reportWithToothlessKernelFile())
          })),
        Then('the layer-provided evaluator also succeeds with the VerdictFail exit class')((s, expect) =>
          expect(verdictOfExit(s.exit)).toEqual({ success: true, value: 'VerdictFail' })
        ),
      ),
    )

    scenario(
      'An unreadable report fails evaluation with an error',
      Gherkin.Do.pipe(
        Given('an evaluator service with disableBail true')(
          'evaluator',
          () => evaluatorServiceWith({ disableBail: true }),
        ),
        When('a report missing required fields is evaluated')('exit', (s) => {
          const brokenReport = reportWithToothlessKernelFile()
          Object.defineProperty(brokenReport, 'files', {
            get() {
              throw new Error('report files unreadable')
            },
          })
          return exitOf(s.evaluator, brokenReport)
        }),
        Then('the evaluation fails with EvaluatorFailed')((s, expect) =>
          expect(failedWithCause(s.exit)).toEqual({ failed: true, hasCause: true })
        ),
      ),
    )
  })
