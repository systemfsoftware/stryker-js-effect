import type { Program } from '../Ast.handle.js'
import { ParseFailed } from '../Parser.schema.js'
import type { Oxc } from '../Parser.service.js'

export const EMBEDDED_SCRIPT_FILE = 'embedded-script.js'

export const makeScriptParser = (oxc: Oxc) => (source: string, scriptFormat: 'js' | 'ts' | 'tsx'): Program => {
  const result = oxc.parseSync(EMBEDDED_SCRIPT_FILE, source, { lang: scriptFormat, range: true })
  const first = result.errors.at(0)
  if (first !== undefined) {
    throw ParseFailed.make({
      fileName: EMBEDDED_SCRIPT_FILE,
      message: first.message,
      location: { line: 0, column: 0 },
      cause: first,
    })
  }
  return result.program
}
