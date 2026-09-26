import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { ErrorText, Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

import type { CheckMutantsError } from './check-mutants.workflow.js'
import { checkMutants, DiagnosticInUnrelatedFileError, DiagnosticWithoutFileError } from './check-mutants.workflow.js'
import { CheckMutantsCommand } from './Checker.schema.js'
import { CheckMutantsInput } from './CheckMutants.schema.js'
import type { CompilerError } from './Compiler.schema.js'
import { check, nodes } from './ts-compiler.handle.js'
import { TypeScriptCompiler } from './ts-compiler.service.js'

type CheckRefusalCause = CompilerError | CheckMutantsError | string

const refuse = (
  options: { readonly mutantIds: readonly Mutant.MutantId[]; readonly cause: CheckRefusalCause },
): Checker.CheckerFailed =>
  Checker.CheckerFailed.make({
    checkerName: 'typescript',
    mutantIds: options.mutantIds,
    cause: Option.getOrElse(Option.map(ErrorText.errorTextOf(options.cause), (rendered) => rendered.text), () => ''),
  })

export type CheckMutantsRead = (typeof CheckMutantsInput)['Encoded']

export const checkCell = Sandwich.named('stryker.typescript_checker.check_mutants')((command: CheckMutantsCommand) =>
  Effect.flatMap(TypeScriptCompiler, (compiler) =>
    Effect.zipWith(
      nodes(compiler),
      check(compiler, [...command.mutants]),
      (graphNodes, diagnostics): CheckMutantsRead =>
        CheckMutantsInput.make({
          mutants: [...command.mutants],
          diagnostics: [...diagnostics],
          nodes: Object.fromEntries(graphNodes),
        }),
    )).pipe(
      Effect.mapError((cause) => refuse({ mutantIds: command.mutants.map((mutant) => mutant.id), cause })),
    )
)
  .decide(checkMutants)
  .write({
    CheckFinished: (answer) => Effect.succeed(answer),
    RetestRequired: (answer) => Effect.succeed(answer),
    DiagnosticWithoutFileError: ({ text }) =>
      Effect.fail(refuse({ mutantIds: [], cause: DiagnosticWithoutFileError.make({ text }) })),
    DiagnosticInUnrelatedFileError: ({ text, fileName }) =>
      Effect.fail(refuse({ mutantIds: [], cause: DiagnosticInUnrelatedFileError.make({ text, fileName }) })),
    CommandRejected: ({ issue }) => Effect.fail(refuse({ mutantIds: [], cause: issue })),
  })
