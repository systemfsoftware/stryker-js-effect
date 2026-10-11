export { ConfigDocumentSchema } from '../Config.schema.js'
export {
  extendsPropertySchema,
  ExtendsStepDocumentSchema,
  ExtendsStepStateSchema,
  forkOptionsSchema,
  ImportedModuleSchema,
  MergeCommand,
  MergeResult,
  ReadConfigCommand,
  survivorsPriorReport,
} from '../Config.schema.js'
export type { ExtendsRefusalReason, ExtendsStepDocument, ExtendsStepState } from '../Config.schema.js'
export { createDefaultOptions, defaultOptions } from '../config/default-options.js'
export { mergeConfigs } from '../config/merge-config.js'
export type { Immutable, ImmutablePrimitive, Primitive } from '../config/stryker-config.schema.js'
export {
  ConfigError,
  ConfigFileInvalidError,
  ConfigFileNotFoundError,
  ConfigFileUnreadableError,
  ConfigFileUnsupportedError,
} from '../ConfigError.schema.js'
export { FileMatcher } from '../matching.schema.js'
export {
  ExtendsStepDone,
  ExtendsStepRead,
  ExtendsStepRefused,
  ExtendsStepResolve,
} from '../run/extends-step.workflow.js'
export type { ExtendsStepDecision } from '../run/extends-step.workflow.js'
export { loadConfigCell } from '../run/load-config.cell.js'
export type { ConfigInvocation, ValidationSchemaDocument } from '../run/load-config.cell.js'
export { describeErrors, forkCoreSchema, readConfig } from '../run/load-config.js'
export { decideExtendsStep, importModule, initialExtendsStepState } from '../run/read-config-document.js'
export { validateOptions } from '../run/validate-options.js'
