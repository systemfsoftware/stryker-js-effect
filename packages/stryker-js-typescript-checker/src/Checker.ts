import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { errorToString } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, CheckerFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import type { CheckerMutantWire, CheckResult } from '@systemfsoftware/stryker-js-plugin-interface'
import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { Result } from 'effect'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import { DiagnosticCategory } from 'typescript/unstable/sync'
import type { Diagnostic } from 'typescript/unstable/sync'
import {
  type CheckFinished,
  checkMutants,
  type CheckMutantsDecision,
  DiagnosticInUnrelatedFileError,
  DiagnosticWithoutFileError,
} from './check-mutants.workflow.js'
import { CheckMutantsCommand } from './Checker.schema.js'
import { CheckMutantsInput } from './CheckMutants.schema.js'
import { TypeScriptCompiler } from './Compiler.js'
import { groupMutants } from './mutant-groups.js'

function getPrioritize(options: StrykerOptions): boolean {
  return Match.value(options.checkers[0]).pipe(
    Match.when(Match.undefined, () => false),
    Match.orElse((first) =>
      Match.value(first.options).pipe(
        Match.when(Match.undefined, () => false),
        Match.orElse((opts) =>
          Match.value(opts['prioritizePerformanceOverAccuracy']).pipe(
            Match.when(true, () => true),
            Match.orElse(() => false),
          )
        ),
      )
    ),
  )
}

interface CheckerDeps {
  readonly options: StrykerOptions
  readonly compiler: TypeScriptCompiler['Service']
}

type RunAnswers = CheckFinished['results']

const refuse = <E = unknown>(mutantIds: ReadonlyArray<string>, cause: E): CheckerFailed =>
  CheckerFailed.make({ checkerName: 'typescript', mutantIds: [...mutantIds], cause: errorToString(cause) })

const severityOf = (category: DiagnosticCategory): string =>
  Match.value(category).pipe(
    Match.when(DiagnosticCategory.Error, () => 'error'),
    Match.when(DiagnosticCategory.Warning, () => 'warning'),
    Match.when(DiagnosticCategory.Suggestion, () => 'suggestion'),
    Match.orElse(() => 'message'),
  )

const toCheckResult = (answer: RunAnswers[string]): CheckResult => {
  if (answer.status === 'passed') {
    return { status: 'passed' }
  }
  return { status: 'compileError', reason: answer.reason }
}

const mergeAnswers = (runs: ReadonlyArray<RunAnswers>): HashMap.HashMap<string, CheckResult> =>
  runs.reduce(
    (merged, answers) =>
      Object.entries(answers).reduce((into, [id, answer]) => HashMap.set(into, id, toCheckResult(answer)), merged),
    HashMap.empty<string, CheckResult>(),
  )

const checkCell = Sandwich.read((command: CheckMutantsCommand) =>
  Effect.flatMap(TypeScriptCompiler, (compiler) =>
    Effect.zipWith(
      compiler.nodes,
      compiler.check([...command.mutants]),
      (nodes, diagnostics): CheckMutantsInput =>
        CheckMutantsInput.make({
          mutants: [...command.mutants],
          diagnostics: [...diagnostics],
          nodes: Object.fromEntries(nodes),
        }),
    )).pipe(Effect.mapError((cause) => refuse(command.mutants.map((mutant) => mutant.id), cause)))
)
  .decide(checkMutants)
  .write((outcome: Result.Result<CheckMutantsDecision, DiagnosticWithoutFileError | DiagnosticInUnrelatedFileError>) =>
    Result.match(outcome, {
      onFailure: (failure) => Effect.fail(refuse([], failure)),
      onSuccess: Effect.succeed,
    })
  )

export const makeCheckerService = ({ options, compiler }: CheckerDeps): Checker['Service'] => {
  const verify = Cell.provide(checkCell, Layer.succeed(TypeScriptCompiler, compiler))

  const positionOf = (error: Diagnostic): Effect.Effect<string> =>
    Option.match(Option.filter(Option.fromUndefinedOr(error.fileName), (fileName) => fileName !== ''), {
      onNone: () => Effect.succeed(''),
      onSome: (fileName) =>
        compiler.getLineAndCharacterOfPosition(fileName, error.pos).pipe(
          Effect.orElseSucceed(() => undefined),
          Effect.map((at) =>
            Option.match(Option.fromUndefinedOr(at), {
              onNone: () => `${fileName}(1,1): `,
              onSome: (position) => `${fileName}(${position.line + 1},${position.character + 1}): `,
            })
          ),
        ),
    })

  const formatDiagnostic = (error: Diagnostic): Effect.Effect<string> =>
    positionOf(error).pipe(
      Effect.map((position) => `${position}${severityOf(error.category)} TS${error.code}: ${error.text}`),
    )

  const createErrorText = (errors: readonly Diagnostic[]): Effect.Effect<string> =>
    Effect.map(Effect.forEach(errors, formatDiagnostic), (parts) => parts.join('\n'))

  const soloRound = (mutant: CheckerMutantWire): Effect.Effect<RunAnswers, CheckerFailed> =>
    verify.run(CheckMutantsCommand.make({ mutants: [mutant] })).pipe(
      Effect.withSpan('typescript-checker.soloRound', {
        attributes: {
          'stryker.mutant.id': mutant.id,
        },
      }),
      Effect.map((decision) => decision.results),
    )

  const soloRounds = (decision: CheckMutantsDecision): Effect.Effect<ReadonlyArray<RunAnswers>, CheckerFailed> =>
    Match.value(decision).pipe(
      Match.tag('CheckFinished', () => Effect.succeed<ReadonlyArray<RunAnswers>>([])),
      Match.tag('RetestRequired', (retest) =>
        verify.run(CheckMutantsCommand.make({ mutants: [] })).pipe(
          Effect.flatMap(() => Effect.forEach(retest.needsRetest, soloRound)),
        )),
      Match.exhaustive,
    )

  return {
    init: compiler.init.pipe(
      Effect.mapError((cause) => refuse([], cause)),
      Effect.flatMap((errors) => {
        if (errors.length === 0) {
          return Effect.void
        }
        return createErrorText(errors).pipe(
          Effect.map((text) => refuse([], new Error(`Typescript error(s) found in dry run compilation: ${text}`))),
          Effect.flatMap(Effect.fail),
        )
      }),
    ),

    check: (mutants) =>
      verify.run(CheckMutantsCommand.make({ mutants: [...mutants] })).pipe(
        Effect.flatMap((first) => Effect.map(soloRounds(first), (rounds) => mergeAnswers([first.results, ...rounds]))),
        Effect.withSpan('typescript-checker.check', {
          attributes: {
            'stryker.mutants.count': mutants.length,
          },
        }),
      ),

    group: (mutants) =>
      compiler.nodes.pipe(
        Effect.map((nodes) => groupMutants(mutants, nodes, getPrioritize(options))),
        Effect.mapError((cause) => refuse(mutants.map((mutant) => mutant.id), cause)),
      ),
  }
}
