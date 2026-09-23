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
}

export const recordingToolkit = (
  header: readonly Statement[],
  print: (source: string) => string = (source) => source,
): ToolkitState => {
  const recorded: RecordedScript[] = []
  const sources = new Map<Program, string>()
  return {
    recorded,
    toolkit: {
      parseScript: (source, scriptFormat) => {
        const program = parseSync('region.js', source, { lang: scriptFormat }).program
        sources.set(program, source)
        recorded.push({ source, scriptFormat, program })
        return program
      },
      transformScript: (script) => script,
      printScript: (script) => print(sources.get(script) ?? ''),
      instrumentationHeader: () => header,
    },
  }
}
