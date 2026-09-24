import type { FrameworkContext, Program, ScriptFormat, Statement } from '@systemfsoftware/stryker-framework-interface'
import { parseSync } from 'oxc-parser'

export interface RecordedScript {
  readonly source: string
  readonly scriptFormat: ScriptFormat
  readonly program: Program
}

export interface ToolkitState {
  readonly recorded: RecordedScript[]
  readonly toolkit: FrameworkContext
  readonly printed: Program[]
}

export const recordingToolkit = (
  header: readonly Statement[],
  print: (source: string) => string = (source) => source,
): ToolkitState => {
  const recorded: RecordedScript[] = []
  const printed: Program[] = []
  const sources = new WeakMap<Program, string>()
  return {
    recorded,
    printed,
    toolkit: {
      parseScript: (source, scriptFormat) => {
        const program = parseSync('region.js', source, { lang: scriptFormat }).program
        sources.set(program, source)
        recorded.push({ source, scriptFormat, program })
        return program
      },
      printScript: (script) => {
        printed.push(script)
        return print(sources.get(script) ?? printedStatementsOf(script))
      },
      instrumentationHeader: () => header,
    },
  }
}

const printedStatementsOf = (program: Program): string =>
  program.body.map((statement) => printedStatementOf(statement)).join('\n')

const printedStatementOf = (statement: Statement): string => {
  if (
    statement.type === 'ExpressionStatement' &&
    statement.expression.type === 'Identifier'
  ) {
    return `${statement.expression.name};`
  }
  return '/* unprintable */'
}
