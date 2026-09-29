import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

import { checkMutants } from './check-mutants.workflow.js'
import { CheckMutantsCommand } from './Checker.schema.js'
import { CheckMutantsInput, MutantVerdict } from './CheckMutants.schema.js'
import type { CompilerError } from './Compiler.schema.js'
import { check, describeDiagnostics, type MutantCheck, type TSCompiler } from './ts-compiler.handle.js'
import { TypeScriptCompiler } from './ts-compiler.service.js'

type CheckRefusalCause = CompilerError | string

const refuse = (
  options: { readonly mutantIds: readonly Mutant.MutantId[]; readonly cause: CheckRefusalCause },
): Checker.CheckerFailed =>
  Checker.CheckerFailed.make({
    checkerName: 'typescript',
    mutantIds: options.mutantIds,
    cause: Option.getOrElse(Option.map(ErrorText.errorTextOf(options.cause), (rendered) => rendered.text), () => ''),
  })

export type CheckMutantsRead = (typeof CheckMutantsInput)['Encoded']

const verdictsOf = (
  compiler: TSCompiler,
  checked: ReadonlyArray<MutantCheck>,
): Effect.Effect<ReadonlyArray<MutantVerdict>> =>
  Effect.forEach(
    checked,
    (entry) =>
      Effect.map(
        describeDiagnostics(compiler, entry.diagnostics),
        (diagnostics) => MutantVerdict.make({ id: entry.mutantId, diagnostics: [...diagnostics] }),
      ),
    { concurrency: 1 },
  )

export const checkCell = Sandwich.named(SpanTaxonomy.Spans.typescriptCheckerCheckMutants.name)((
  command: CheckMutantsCommand,
) =>
  Effect.flatMap(
    TypeScriptCompiler,
    (compiler) =>
      Effect.flatMap(check(compiler, [...command.mutants]), (checked) =>
        Effect.map(
          verdictsOf(compiler, checked),
          (verdicts): CheckMutantsRead =>
            CheckMutantsInput.make({ mutants: [...command.mutants], verdicts: [...verdicts] }),
        )),
  ).pipe(
    Effect.mapError((cause) => refuse({ mutantIds: command.mutants.map((mutant) => mutant.id), cause })),
  )
)
  .decide(checkMutants)
  .write({
    MutantPassed: (outcome) => Effect.succeed(outcome),
    MutantFailed: (outcome) => Effect.succeed(outcome),
    CommandRejected: ({ issue }) => Effect.fail(refuse({ mutantIds: [], cause: issue })),
  })
