import type { ExitClass } from './ExitClass.schema.js'

export { ExitClass } from './ExitClass.schema.js'

export const EXIT_CODE: Record<ExitClass, number> = {
  VerdictFail: 1,
  ConfigError: 2,
  RuntimeError: 3,
  InternalError: 4,
}
